defmodule TimelineWeb.GameLive do
  use TimelineWeb, :live_view

  import TimelineWeb.GameComponents
  alias Timeline.Events
  alias Timeline.WikiImages
  @min_round_size 3
  @max_round_size 20
  @default_round_size 6

  @impl true
  def mount(params, _session, socket) do
    {pool, slots, events_by_id} = new_game(params)
    start_image_prefetch(events_by_id)

    {:ok,
     socket
     |> assign(:pool, pool)
     |> assign(:slots, slots)
     |> assign(:events_by_id, events_by_id)
     |> assign(:selected_id, nil)
     |> assign(:score, nil)}
  end

  @impl true
  def handle_event("reset", _params, socket) do
    # keep the same round size as current slots
    round_size = length(socket.assigns.slots)
    {pool, slots, events_by_id} = new_game(%{"size" => round_size})
    start_image_prefetch(events_by_id)

    {:noreply,
     socket
     |> assign(:pool, pool)
     |> assign(:slots, slots)
     |> assign(:events_by_id, events_by_id)
     |> assign(:score, nil)}
  end

  def handle_event("shuffle_pool", _params, socket) do
    {:noreply, assign(socket, :pool, Enum.shuffle(socket.assigns.pool))}
  end

  def handle_event("select_event", %{"id" => id}, socket) do
    selected_id =
      if socket.assigns.selected_id == id do
        nil
      else
        id
      end

    {:noreply, assign(socket, :selected_id, selected_id)}
  end

  def handle_event("place_selected", params, socket) do
    slot_idx = parse_index(params["slot"])
    event_id = Map.get(params, "id") || socket.assigns[:selected_id]
    slots = socket.assigns.slots

    cond do
      is_nil(event_id) ->
        {:noreply, socket}

      not valid_index?(slots, slot_idx) ->
        {:noreply, socket}

      not is_nil(Enum.at(slots, slot_idx)) ->
        # Slot occupied; require explicit removal first
        {:noreply, socket}

      true ->
        pool = socket.assigns.pool
        {selected, new_pool} = pop_from_pool(pool, event_id)

        if is_nil(selected) do
          {:noreply, socket}
        else
          new_slots = List.replace_at(slots, slot_idx, selected.id)

          {:noreply,
           socket
           |> assign(:pool, new_pool)
           |> assign(:slots, new_slots)
           |> assign(:score, nil)}
        end
    end
  end

  def handle_event("remove_from_slot", %{"slot" => slot_idx_str}, socket) do
    slot_idx = parse_index(slot_idx_str)
    slots = socket.assigns.slots

    if valid_index?(slots, slot_idx) do
      case Enum.at(slots, slot_idx) do
        nil ->
          {:noreply, socket}

        event_id ->
          event = Map.fetch!(socket.assigns.events_by_id, event_id)
          new_slots = List.replace_at(slots, slot_idx, nil)
          new_pool = [event | socket.assigns.pool]

          {:noreply,
           socket
           |> assign(:slots, new_slots)
           |> assign(:pool, new_pool)
           |> assign(:score, nil)}
      end
    else
      {:noreply, socket}
    end
  end

  def handle_event("score", _params, socket) do
    slots = socket.assigns.slots
    events_by_id = socket.assigns.events_by_id

    {filled, displacement, correct} =
      slots
      |> Enum.with_index()
      |> Enum.reduce({0, 0, 0}, fn
        {nil, _idx}, acc ->
          acc

        {event_id, idx}, {filled_acc, disp_acc, corr_acc} ->
          event = Map.fetch!(events_by_id, event_id)
          correct_pos = event.correct_pos
          disp = abs(correct_pos - idx)
          is_correct = if correct_pos == idx, do: 1, else: 0
          {filled_acc + 1, disp_acc + disp, corr_acc + is_correct}
      end)

    total = length(slots)

    score = %{
      total_slots: total,
      filled_slots: filled,
      correct_positions: correct,
      total_displacement: displacement,
      percent_correct: percent(correct, total)
    }

    {:noreply, assign(socket, :score, score)}
  end

  @impl true
  def handle_info({:wiki_image, id, url}, socket) do
    updated_event =
      socket.assigns.events_by_id
      |> Map.get(id)
      |> case do
        nil -> nil
        e -> Map.put(e, :image_src, url)
      end

    if is_nil(updated_event) do
      {:noreply, socket}
    else
      events_by_id = Map.put(socket.assigns.events_by_id, id, updated_event)

      pool =
        Enum.map(socket.assigns.pool, fn e ->
          if e.id == id, do: updated_event, else: e
        end)

      {:noreply, socket |> assign(:events_by_id, events_by_id) |> assign(:pool, pool)}
    end
  end

  defp start_image_prefetch(events_by_id) when is_map(events_by_id) do
    parent = self()

    queries =
      for {_id, e} <- events_by_id, placeholder_image?(Map.get(e, :image_src)) do
        e.weblink || e.title
      end

    if queries != [] do
      WikiImages.prefetch(queries)
    end

    Enum.each(events_by_id, fn {_id, e} ->
      if placeholder_image?(Map.get(e, :image_src)) do
        Task.start(fn ->
          case WikiImages.get_image_url(e.weblink || e.title) do
            {:ok, url} -> send(parent, {:wiki_image, e.id, url})
            _ -> :noop
          end
        end)
      end
    end)

    :ok
  end

  # HELPERS

  defp new_game(params) do
    size_param =
      case params do
        %{} -> Map.get(params, "size")
        _ -> nil
      end

    base_events =
      case Events.load() do
        {:ok, list} -> list
        {:error, _reason} -> []
      end

    total = length(base_events)

    requested =
      cond do
        is_integer(size_param) ->
          size_param

        is_binary(size_param) ->
          case Integer.parse(size_param) do
            {i, _} -> i
            :error -> @default_round_size
          end

        true ->
          @default_round_size
      end

    size =
      requested
      |> max(@min_round_size)
      |> min(@max_round_size)
      |> min(total)
      |> max(0)

    sample =
      base_events
      |> Enum.take_random(size)

    # Determine the correct order by chronological year (ascending).
    # Events without a year are placed at the end, tie-breaking by title.
    ordered_subset =
      sample
      |> Enum.sort_by(&sort_key/1)
      |> Enum.with_index()

    events_with_meta =
      Enum.map(ordered_subset, fn {e, correct_pos} ->
        %{
          id: "ev-" <> Integer.to_string(System.unique_integer([:positive])),
          title: e.title,
          image_src: sanitize_image_src(e.image_src),
          description: e.description,
          weblink: e.weblink,
          correct_pos: correct_pos
        }
      end)

    pool = Enum.shuffle(events_with_meta)
    slots = for _ <- 1..length(events_with_meta), do: nil
    events_by_id = Map.new(events_with_meta, &{&1.id, &1})

    {pool, slots, events_by_id}
  end

  defp sort_key(e) do
    y =
      case e do
        %{year: year} when is_integer(year) -> year
        _ -> 9_999_999
      end

    {y, e.title}
  end

  defp pop_from_pool(pool, id) do
    case Enum.split_with(pool, &(&1.id != id)) do
      {left, [match | rest]} ->
        {match, left ++ rest}

      {_left, []} ->
        {nil, pool}
    end
  end

  defp parse_index(i) when is_integer(i), do: i

  defp parse_index(str) when is_binary(str) do
    case Integer.parse(str) do
      {i, _} -> i
      :error -> -1
    end
  end

  defp valid_index?(list, idx) do
    idx >= 0 and idx < length(list)
  end

  defp percent(_num, 0), do: 0

  defp percent(num, den) when is_integer(num) and is_integer(den) and den > 0 do
    trunc(num * 100 / den)
  end

  defp placeholder_image?(nil), do: true

  defp placeholder_image?(url) when is_binary(url) do
    String.contains?(url, "via.placeholder.com")
  end

  defp placeholder_image?(_), do: false

  defp sanitize_image_src(url) do
    if placeholder_image?(url), do: nil, else: url
  end
end
