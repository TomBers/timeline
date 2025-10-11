defmodule TimelineWeb.GeoLive do
  use TimelineWeb, :live_view

  import TimelineWeb.GameComponents

  alias Timeline.Places
  alias Timeline.WikiImages

  @rows 3
  @cols 3

  # Orientation note:
  # We render North at the top (row 0), South at the bottom (row 2),
  # West to the left (col 0), East to the right (col 2).
  # Therefore:
  # - North-West (highest lat, lowest lon) -> top-left (row 0, col 0)
  # - South-East (lowest lat, highest lon) -> bottom-right (row 2, col 2)

  @impl true
  def mount(params, _session, socket) do
    {pool, grid, places_by_id} = new_game(params)
    start_image_prefetch(places_by_id)

    {:ok,
     socket
     |> assign(:pool, pool)
     |> assign(:grid, grid)
     |> assign(:places_by_id, places_by_id)
     |> assign(:selected_id, nil)
     |> assign(:score, nil)}
  end

  @impl true
  def handle_event("reset", _params, socket) do
    {pool, grid, places_by_id} = new_game(%{})
    start_image_prefetch(places_by_id)

    {:noreply,
     socket
     |> assign(:pool, pool)
     |> assign(:grid, grid)
     |> assign(:places_by_id, places_by_id)
     |> assign(:selected_id, nil)
     |> assign(:score, nil)}
  end

  def handle_event("shuffle_pool", _params, socket) do
    {:noreply, assign(socket, :pool, Enum.shuffle(socket.assigns.pool))}
  end

  def handle_event("select_place", %{"id" => id}, socket) do
    selected_id =
      if socket.assigns.selected_id == id do
        nil
      else
        id
      end

    {:noreply, assign(socket, :selected_id, selected_id)}
  end

  def handle_event("place_selected", params, socket) do
    slot_idx = parse_index(Map.get(params, "slot"))
    id = Map.get(params, "id") || socket.assigns[:selected_id]

    cond do
      is_nil(id) ->
        {:noreply, socket}

      not valid_index?(socket.assigns.grid, slot_idx) ->
        {:noreply, socket}

      not is_nil(Enum.at(socket.assigns.grid, slot_idx)) ->
        # Occupied; require explicit removal
        {:noreply, socket}

      true ->
        pool = socket.assigns.pool
        {selected, new_pool} = pop_from_pool(pool, id)

        if is_nil(selected) do
          {:noreply, socket}
        else
          new_grid = List.replace_at(socket.assigns.grid, slot_idx, selected.id)

          {:noreply,
           socket
           |> assign(:pool, new_pool)
           |> assign(:grid, new_grid)
           |> assign(
             :score,
             if(new_pool == [],
               do: compute_score(new_grid, socket.assigns.places_by_id),
               else: nil
             )
           )}
        end
    end
  end

  def handle_event("remove_from_slot", %{"slot" => slot_idx_str}, socket) do
    slot_idx = parse_index(slot_idx_str)
    grid = socket.assigns.grid

    if valid_index?(grid, slot_idx) do
      case Enum.at(grid, slot_idx) do
        nil ->
          {:noreply, socket}

        id ->
          place = Map.fetch!(socket.assigns.places_by_id, id)
          new_grid = List.replace_at(grid, slot_idx, nil)
          new_pool = [place | socket.assigns.pool]

          {:noreply,
           socket
           |> assign(:grid, new_grid)
           |> assign(:pool, new_pool)
           |> assign(:score, nil)}
      end
    else
      {:noreply, socket}
    end
  end

  def handle_event("score", _params, socket) do
    score = compute_score(socket.assigns.grid, socket.assigns.places_by_id)
    {:noreply, assign(socket, :score, score)}
  end

  @impl true
  def handle_info({:wiki_image, id, url}, socket) do
    updated_place =
      socket.assigns.places_by_id
      |> Map.get(id)
      |> case do
        nil -> nil
        e -> Map.put(e, :image_src, url)
      end

    if is_nil(updated_place) do
      {:noreply, socket}
    else
      places_by_id = Map.put(socket.assigns.places_by_id, id, updated_place)

      pool =
        Enum.map(socket.assigns.pool, fn e ->
          if e.id == id, do: updated_place, else: e
        end)

      {:noreply, socket |> assign(:places_by_id, places_by_id) |> assign(:pool, pool)}
    end
  end

  # RENDER

  # COMPONENTS

  attr :class, :any, default: nil

  def geo_compass(assigns) do
    ~H"""
    <div
      class={[
        "relative w-20 h-20 rounded-full border-2 border-base-300 bg-base-100 flex items-center justify-center select-none",
        @class
      ]}
      title="Compass"
    >
      <div class="absolute top-0 left-1/2 -translate-x-1/2 text-[10px] font-semibold">N</div>
      <div class="absolute bottom-0 left-1/2 -translate-x-1/2 text-[10px] font-semibold">S</div>
      <div class="absolute left-0 top-1/2 -translate-y-1/2 text-[10px] font-semibold">W</div>
      <div class="absolute right-0 top-1/2 -translate-y-1/2 text-[10px] font-semibold">E</div>

      <div class="w-1 h-6 bg-primary rounded-full absolute top-1/2 -translate-y-1/2"></div>
      <div class="w-1 h-6 bg-secondary rounded-full absolute top-1/2 -translate-y-1/2 rotate-90">
      </div>
    </div>
    """
  end

  # HELPERS

  defp new_game(_params) do
    base_places =
      case Places.load() do
        {:ok, list} -> list
        {:error, _reason} -> []
      end

    # pick up to 9 places
    size = min(@rows * @cols, length(base_places))
    sample = Enum.take_random(base_places, size)

    {lat_min, lat_max} = minmax(sample, & &1.latitude)
    {lon_min, lon_max} = minmax(sample, & &1.longitude)

    with_meta =
      sample
      |> Enum.map(fn p ->
        id = "pl-" <> Integer.to_string(System.unique_integer([:positive]))

        row = lat_row(p.latitude, lat_min, lat_max, @rows)
        col = lon_col(p.longitude, lon_min, lon_max, @cols)
        correct_pos = from_rc(row, col)

        %{
          id: id,
          title: p.title,
          image_src: sanitize_image_src(p.image_src),
          description: p.description,
          weblink: p.weblink,
          latitude: p.latitude,
          longitude: p.longitude,
          correct_pos: correct_pos
        }
      end)

    places_by_id = Map.new(with_meta, &{&1.id, &1})
    pool = Enum.shuffle(with_meta)
    grid = for _ <- 1..(@rows * @cols), do: nil

    {pool, grid, places_by_id}
  end

  defp lat_row(lat, min, max, bands) do
    # Higher latitude => more North => smaller row index (0 at top)
    idx = band_index(lat, min, max, bands)
    bands - 1 - idx
  end

  defp lon_col(lon, min, max, bands) do
    # Lower longitude (more West) => smaller col index
    band_index(lon, min, max, bands)
  end

  defp band_index(val, min, max, bands) when is_number(val) and bands > 0 do
    if max <= min do
      0
    else
      span = max - min
      pos = (val - min) / span
      # Clamp and quantize into 0..bands-1
      q =
        cond do
          pos <= 0.0 -> 0
          pos >= 1.0 -> bands - 1
          true -> trunc(Float.floor(pos * bands))
        end

      q |> max(0) |> min(bands - 1)
    end
  end

  defp minmax(list, fun) when is_list(list) and is_function(fun, 1) do
    case list do
      [] -> {0.0, 0.0}
      _ -> Enum.map(list, fun) |> Enum.min_max()
    end
  end

  defp from_rc(row, col), do: row * @cols + col

  def to_rc(idx) when is_integer(idx) and idx >= 0 do
    {div(idx, @cols), rem(idx, @cols)}
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

  defp compute_score(grid, places_by_id) do
    {filled, displacement, correct} =
      grid
      |> Enum.with_index()
      |> Enum.reduce({0, 0, 0}, fn
        {nil, _idx}, acc ->
          acc

        {id, idx}, {filled_acc, disp_acc, corr_acc} ->
          place = Map.fetch!(places_by_id, id)

          {r1, c1} = to_rc(idx)
          {r2, c2} = to_rc(place.correct_pos)

          manhattan = abs(r1 - r2) + abs(c1 - c2)
          is_correct = if idx == place.correct_pos, do: 1, else: 0

          {filled_acc + 1, disp_acc + manhattan, corr_acc + is_correct}
      end)

    total = length(grid)

    %{
      total_slots: total,
      filled_slots: filled,
      correct_positions: correct,
      total_manhattan_displacement: displacement,
      percent_correct: percent(correct, total)
    }
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

  defp start_image_prefetch(places_by_id) when is_map(places_by_id) do
    parent = self()

    queries =
      for {_id, p} <- places_by_id, placeholder_image?(Map.get(p, :image_src)) do
        p.weblink || p.title
      end

    if queries != [] do
      WikiImages.prefetch(queries)
    end

    Enum.each(places_by_id, fn {_id, p} ->
      if placeholder_image?(Map.get(p, :image_src)) do
        Task.start(fn ->
          case WikiImages.get_image_url(p.weblink || p.title) do
            {:ok, url} -> send(parent, {:wiki_image, p.id, url})
            _ -> :noop
          end
        end)
      end
    end)

    :ok
  end
end
