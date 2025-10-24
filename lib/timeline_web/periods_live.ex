defmodule TimelineWeb.PeriodsLive do
  use TimelineWeb, :live_view

  alias Timeline.Periods
  alias Timeline.WikiImages
  import TimelineWeb.GameComponents

  @min_round_size 3
  @max_round_size 20
  @default_round_size 6
  @min_duration_years 1

  @impl true
  def mount(params, _session, socket) do
    {periods_by_id, order, axis_min, axis_max, pool, placed} = new_game(params)
    start_image_prefetch(periods_by_id)

    {id_to_lane, lane_count} = compute_stable_lanes(periods_by_id, order)

    ticks = build_ticks(axis_min, axis_max)
    lanes = build_lanes_from_placed(id_to_lane, lane_count, placed)

    {:ok,
     socket
     |> assign(:axis_min, axis_min)
     |> assign(:axis_max, axis_max)
     |> assign(:periods_by_id, periods_by_id)
     |> assign(:order, order)
     |> assign(:pool, pool)
     |> assign(:placed, placed)
     |> assign(:score, nil)
     |> assign(:lanes, lanes)
     |> assign(:id_to_lane, id_to_lane)
     |> assign(:lane_overrides, %{})
     |> assign(:lane_by_id, id_to_lane)
     |> assign(:lane_count, lane_count)
     |> assign(:ticks, ticks)}
  end

  @impl true
  def handle_event("reset", _params, socket) do
    size = socket.assigns.order |> length()
    {periods_by_id, order, axis_min, axis_max, pool, placed} = new_game(%{"size" => size})
    start_image_prefetch(periods_by_id)

    {id_to_lane, lane_count} = compute_stable_lanes(periods_by_id, order)

    ticks = build_ticks(axis_min, axis_max)
    lanes = build_lanes_from_placed(id_to_lane, lane_count, placed)

    {:noreply,
     socket
     |> assign(:axis_min, axis_min)
     |> assign(:axis_max, axis_max)
     |> assign(:periods_by_id, periods_by_id)
     |> assign(:order, order)
     |> assign(:pool, pool)
     |> assign(:placed, placed)
     |> assign(:score, nil)
     |> assign(:lanes, lanes)
     |> assign(:id_to_lane, id_to_lane)
     |> assign(:lane_overrides, %{})
     |> assign(:lane_by_id, id_to_lane)
     |> assign(:lane_count, lane_count)
     |> assign(:ticks, ticks)}
  end

  # Pool -> timeline placement (drag-drop)
  def handle_event("place_from_pool", %{"id" => id} = params, socket) do
    pool = socket.assigns.pool
    placed = socket.assigns.placed

    # Ignore if already placed or not in pool
    cond do
      id in placed ->
        {:noreply, socket}

      is_nil(Enum.find(pool, &(&1 == id))) ->
        {:noreply, socket}

      true ->
        # Optionally set initial guess centered under the drop year if provided
        {periods_by_id, new_placed} =
          case Map.get(params, "drop_year") do
            nil ->
              {socket.assigns.periods_by_id, placed ++ [id]}

            drop_year_str ->
              axis_min = socket.assigns.axis_min
              axis_max = socket.assigns.axis_max
              drop_year = parse_int(drop_year_str, axis_min)

              p = Map.fetch!(socket.assigns.periods_by_id, id)
              dur = max(p.guess_end - p.guess_start, @min_duration_years)

              start =
                drop_year
                |> Kernel.-(div(dur, 2))
                |> max(axis_min)
                |> min(axis_max - dur)

              updated_p = %{p | guess_start: start, guess_end: start + dur}
              {Map.put(socket.assigns.periods_by_id, id, updated_p), placed ++ [id]}
          end

        new_pool = Enum.reject(pool, &(&1 == id))

        lanes =
          build_lanes_from_placed(
            socket.assigns.id_to_lane,
            socket.assigns.lane_count,
            new_placed
          )

        {:noreply,
         socket
         |> assign(:periods_by_id, periods_by_id)
         |> assign(:pool, new_pool)
         |> assign(:placed, new_placed)
         |> assign(:lanes, lanes)
         |> assign(
           :lane_by_id,
           Map.merge(socket.assigns.id_to_lane, socket.assigns.lane_overrides)
         )
         |> assign(:score, nil)}
    end
  end

  # Remove from timeline lane back to pool
  def handle_event("remove_from_lane", %{"id" => id}, socket) do
    placed = socket.assigns.placed
    pool = socket.assigns.pool

    if id in placed do
      new_placed = Enum.reject(placed, &(&1 == id))
      new_pool = [id | pool]

      lanes =
        build_lanes_from_placed(
          socket.assigns.id_to_lane,
          socket.assigns.lane_count,
          new_placed
        )

      {:noreply,
       socket
       |> assign(:placed, new_placed)
       |> assign(:pool, new_pool)
       |> assign(:lanes, lanes)
       |> assign(:lane_by_id, Map.merge(socket.assigns.id_to_lane, socket.assigns.lane_overrides))
       |> assign(:score, nil)}
    else
      {:noreply, socket}
    end
  end

  # Optional: re-order pool for UX
  def handle_event("shuffle_pool", _params, socket) do
    {:noreply, assign(socket, :pool, Enum.shuffle(socket.assigns.pool))}
  end

  def handle_event("nudge", %{"id" => id, "delta" => delta_str}, socket) do
    delta = parse_int(delta_str, 0)

    updated =
      update_guess(socket.assigns.periods_by_id, id, fn p ->
        move_guess(p, delta, socket.assigns.axis_min, socket.assigns.axis_max)
      end)

    {:noreply,
     socket
     |> assign(:periods_by_id, updated)
     |> assign(:score, nil)}
  end

  def handle_event("resize", %{"id" => id, "edge" => edge, "delta" => delta_str}, socket) do
    delta = parse_int(delta_str, 0)

    updated =
      update_guess(socket.assigns.periods_by_id, id, fn p ->
        resize_guess(p, edge, delta, socket.assigns.axis_min, socket.assigns.axis_max)
      end)

    {:noreply,
     socket
     |> assign(:periods_by_id, updated)
     |> assign(:score, nil)}
  end

  def handle_event("set_guess", %{"id" => id} = params, socket) do
    updated =
      update_guess(socket.assigns.periods_by_id, id, fn p ->
        guess_start =
          case Map.get(params, "guess_start") do
            nil -> p.guess_start
            v -> parse_int(v, p.guess_start)
          end

        guess_end =
          case Map.get(params, "guess_end") do
            nil -> p.guess_end
            v -> parse_int(v, p.guess_end)
          end

        clamp_guess(
          %{p | guess_start: guess_start, guess_end: guess_end},
          socket.assigns.axis_min,
          socket.assigns.axis_max
        )
      end)

    lane_overrides =
      case Map.get(params, "lane") do
        nil ->
          socket.assigns.lane_overrides || %{}

        lane_str ->
          lc = max((socket.assigns.lane_count || 1) - 1, 0)

          lane_val =
            parse_int(lane_str, 0)
            |> max(0)
            |> min(lc)

          Map.put(socket.assigns.lane_overrides || %{}, id, lane_val)
      end

    lane_by_id = Map.merge(socket.assigns.id_to_lane, lane_overrides)

    {:noreply,
     socket
     |> assign(:periods_by_id, updated)
     |> assign(:lane_overrides, lane_overrides)
     |> assign(:lane_by_id, lane_by_id)
     |> assign(:score, nil)}
  end

  def handle_event("score", _params, socket) do
    periods = socket.assigns.order |> Enum.map(&Map.fetch!(socket.assigns.periods_by_id, &1))

    {sum_iou, sum_start_err, sum_end_err, perfect, total} =
      Enum.reduce(periods, {0.0, 0, 0, 0, 0}, fn p, {acc_iou, acc_se, acc_ee, acc_perf, acc_t} ->
        iou = iou(p.guess_start, p.guess_end, p.start_year, p.end_year)
        se = abs(p.guess_start - p.start_year)
        ee = abs(p.guess_end - p.end_year)
        perf = if se == 0 and ee == 0, do: 1, else: 0
        {acc_iou + iou, acc_se + se, acc_ee + ee, acc_perf + perf, acc_t + 1}
      end)

    avg_iou = if total > 0, do: sum_iou / total, else: 0.0
    mean_abs_start_err = if total > 0, do: round(sum_start_err / total), else: 0
    mean_abs_end_err = if total > 0, do: round(sum_end_err / total), else: 0

    score = %{
      total: total,
      avg_iou: Float.round(avg_iou, 3),
      avg_iou_pct: trunc(avg_iou * 100),
      mean_abs_start_err: mean_abs_start_err,
      mean_abs_end_err: mean_abs_end_err,
      perfect_count: perfect
    }

    {:noreply, assign(socket, :score, score)}
  end

  @impl true
  def handle_info({:wiki_image, id, url}, socket) do
    case Map.get(socket.assigns.periods_by_id, id) do
      nil ->
        {:noreply, socket}

      period ->
        updated_by_id =
          Map.put(socket.assigns.periods_by_id, id, Map.put(period, :image_src, url))

        {:noreply, assign(socket, :periods_by_id, updated_by_id)}
    end
  end

  # HELPERS

  defp new_game(params) do
    size_param =
      case params do
        %{} -> Map.get(params, "size")
        _ -> nil
      end

    base_periods =
      case Periods.load() do
        {:ok, list} -> list
        {:error, _reason} -> []
      end

    total = length(base_periods)

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

    # Optional scoping: explicit axis_min/axis_max or a limited window (in years)
    {base_scoped, forced_axis} =
      case params do
        %{} ->
          ax_min_s = Map.get(params, "axis_min")
          ax_max_s = Map.get(params, "axis_max")
          window_s = Map.get(params, "window_years") || Map.get(params, "window")

          cond do
            is_binary(ax_min_s) and is_binary(ax_max_s) ->
              case {Integer.parse(ax_min_s), Integer.parse(ax_max_s)} do
                {{min_i, _}, {max_i, _}} ->
                  min_v = min(min_i, max_i)
                  max_v = max(min_i, max_i)

                  filtered =
                    Enum.filter(base_periods, fn p ->
                      p.end_year >= min_v and p.start_year <= max_v
                    end)

                  {filtered, {min_v, max_v}}

                _ ->
                  {base_periods, nil}
              end

            is_binary(window_s) ->
              case Integer.parse(window_s) do
                {win, _} when win > 0 ->
                  # Use the median midpoint as the window center for a denser round
                  mids =
                    base_periods
                    |> Enum.map(fn p -> div(p.start_year + p.end_year, 2) end)
                    |> Enum.sort()

                  center =
                    case mids do
                      [] -> 0
                      _ -> Enum.at(mids, div(length(mids), 2)) || 0
                    end

                  min_v = center - div(win, 2)
                  max_v = min_v + win

                  filtered =
                    Enum.filter(base_periods, fn p ->
                      p.end_year >= min_v and p.start_year <= max_v
                    end)

                  {filtered, {min_v, max_v}}

                _ ->
                  {base_periods, nil}
              end

            true ->
              {base_periods, nil}
          end

        _ ->
          {base_periods, nil}
      end

    # Anchor-based windowing: pick a random anchor, then pick nearest (by midpoint) events to fill the round
    {sample, _anchor} =
      if size > 0 and base_scoped != [] do
        anchor =
          case base_scoped do
            [] -> nil
            bs -> Enum.random(bs)
          end

        others = Enum.reject(base_scoped, &(&1 == anchor))

        anchor_mid =
          case anchor do
            nil -> 0
            a -> div(a.start_year + a.end_year, 2)
          end

        others_sorted =
          Enum.sort_by(others, fn p -> abs(div(p.start_year + p.end_year, 2) - anchor_mid) end)

        take_n = max(size - 1, 0) |> min(length(others_sorted))

        selected =
          case anchor do
            nil -> Enum.take(base_scoped, size)
            a -> [a | Enum.take(others_sorted, take_n)]
          end

        {Enum.sort_by(selected, fn p -> {p.start_year, p.end_year, p.title} end), anchor}
      else
        {[], nil}
      end

    # When no axis is forced, set axis to the extremes of the selected sample
    # so at least one event touches the leftmost (min start) and one the rightmost (max end).
    {axis_min, axis_max} =
      case forced_axis do
        {amin, amax} ->
          {amin, amax}

        _ ->
          {
            sample |> Enum.map(& &1.start_year) |> Enum.min(fn -> 0 end),
            sample |> Enum.map(& &1.end_year) |> Enum.max(fn -> 1 end)
          }
      end

    span = max(axis_max - axis_min, 1)

    with_meta =
      Enum.map(sample, fn p ->
        id = "pr-" <> Integer.to_string(System.unique_integer([:positive]))
        duration = max(p.end_year - p.start_year, @min_duration_years)
        max_start = axis_max - duration
        min_start = axis_min

        guess_start =
          if max_start <= min_start do
            min_start
          else
            :rand.uniform(max_start - min_start + 1) + min_start - 1
          end

        guess_end = guess_start + duration

        %{
          id: id,
          title: p.title,
          description: p.description,
          weblink: p.weblink,
          image_src: sanitize_image_src(p.image_src),
          start_year: p.start_year,
          end_year: p.end_year,
          guess_start: guess_start,
          guess_end: guess_end,
          axis_min: axis_min,
          axis_max: axis_max,
          span: span
        }
      end)

    periods_by_id = Map.new(with_meta, &{&1.id, &1})
    order = Enum.map(with_meta, & &1.id)
    pool = []
    placed = order

    {periods_by_id, order, axis_min, axis_max, pool, placed}
  end

  defp update_guess(periods_by_id, id, fun) when is_function(fun, 1) do
    case Map.get(periods_by_id, id) do
      nil ->
        periods_by_id

      p ->
        Map.put(periods_by_id, id, fun.(p))
    end
  end

  defp move_guess(p, delta, axis_min, axis_max) do
    dur = max(p.guess_end - p.guess_start, @min_duration_years)
    new_start = p.guess_start + delta
    new_end = p.guess_end + delta

    min_start = axis_min
    max_end = axis_max

    # Clamp to bounds, preserving duration
    cond do
      new_start < min_start ->
        %{p | guess_start: min_start, guess_end: min_start + dur}

      new_end > max_end ->
        %{p | guess_end: max_end, guess_start: max_end - dur}

      true ->
        %{p | guess_start: new_start, guess_end: new_end}
    end
  end

  defp resize_guess(p, edge, delta, axis_min, axis_max) do
    start = p.guess_start
    endv = p.guess_end

    {new_start, new_end} =
      case edge do
        "start" ->
          ns = start + delta
          ns = min(ns, endv - @min_duration_years)
          ns = max(ns, axis_min)
          {ns, endv}

        "end" ->
          ne = endv + delta
          ne = max(ne, start + @min_duration_years)
          ne = min(ne, axis_max)
          {start, ne}

        _ ->
          {start, endv}
      end

    %{p | guess_start: new_start, guess_end: new_end}
  end

  defp clamp_guess(p, axis_min, axis_max) do
    start = p.guess_start |> max(axis_min) |> min(axis_max - @min_duration_years)
    endv = p.guess_end |> max(start + @min_duration_years) |> min(axis_max)
    %{p | guess_start: start, guess_end: endv}
  end

  defp iou(gs, ge, ts, te) do
    inter = max(0, min(ge, te) - max(gs, ts))
    union = max(ge - gs, 0) + max(te - ts, 0) - inter
    if union <= 0, do: 0.0, else: inter / union
  end

  # percent helpers for template
  defp pos_pct(axis_min, axis_max, year) do
    span = axis_max - axis_min

    if span <= 0 do
      0
    else
      ((year - axis_min) * 100.0 / span) |> clamp_pct()
    end
  end

  defp len_pct(axis_min, axis_max, from, to) do
    span = axis_max - axis_min

    if span <= 0 do
      0
    else
      ((to - from) * 100.0 / span) |> clamp_pct()
    end
  end

  defp clamp_pct(v) when is_number(v) do
    v
    |> max(0.0)
    |> min(100.0)
  end

  defp format_year(y) when is_integer(y) do
    cond do
      y < 0 -> "#{abs(y)} BCE"
      y == 0 -> "0"
      true -> "#{y} CE"
    end
  end

  defp parse_int(v, _default) when is_integer(v), do: v

  defp parse_int(v, default) when is_binary(v) do
    case Integer.parse(v) do
      {i, _} -> i
      :error -> default
    end
  end

  defp parse_int(_, default), do: default

  defp start_image_prefetch(periods_by_id) when is_map(periods_by_id) do
    parent = self()

    queries =
      for {_id, p} <- periods_by_id, placeholder_image?(Map.get(p, :image_src)) do
        p.weblink || p.title
      end

    if queries != [] do
      WikiImages.prefetch(queries)
    end

    Enum.each(periods_by_id, fn {_id, p} ->
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

  defp placeholder_image?(nil), do: true

  defp placeholder_image?(url) when is_binary(url) do
    String.contains?(url, "via.placeholder.com")
  end

  defp placeholder_image?(_), do: false

  defp sanitize_image_src(url) do
    if placeholder_image?(url), do: nil, else: url
  end

  # Stable lane assignment computed once from truth ranges (prevents lane flipping during drags)
  defp compute_stable_lanes(periods_by_id, order) when is_map(periods_by_id) and is_list(order) do
    periods =
      order
      |> Enum.map(&Map.fetch!(periods_by_id, &1))
      |> Enum.sort_by(fn p -> {p.start_year, p.end_year, p.id} end)

    {_lanes_acc, id_to_lane, ends_acc} =
      Enum.reduce(periods, {[], %{}, []}, fn p, {lanes_acc, id_to_lane_acc, ends} ->
        case Enum.find_index(ends, fn last_end -> p.start_year >= last_end end) do
          nil ->
            idx = length(ends)
            {lanes_acc ++ [[p.id]], Map.put(id_to_lane_acc, p.id, idx), ends ++ [p.end_year]}

          idx ->
            new_ends = List.replace_at(ends, idx, p.end_year)
            new_lanes = List.update_at(lanes_acc, idx, fn ids -> ids ++ [p.id] end)
            {new_lanes, Map.put(id_to_lane_acc, p.id, idx), new_ends}
        end
      end)

    lane_count = length(ends_acc)
    {id_to_lane, lane_count}
  end

  defp build_lanes_from_placed(id_to_lane, lane_count, placed_ids) do
    lanes = for _ <- 1..lane_count, do: []

    Enum.reduce(placed_ids, lanes, fn id, acc ->
      lane = Map.get(id_to_lane, id, 0)
      List.update_at(acc, lane, fn ids -> ids ++ [id] end)
    end)
  end

  defp build_ticks(axis_min, axis_max) when is_integer(axis_min) and is_integer(axis_max) do
    span = max(axis_max - axis_min, 1)
    target = 8.0
    raw_step = span / target
    mag = :math.pow(10.0, :math.floor(:math.log10(raw_step)))
    norm = raw_step / mag

    base =
      cond do
        norm <= 1.0 -> 1.0
        norm <= 2.0 -> 2.0
        norm <= 5.0 -> 5.0
        true -> 10.0
      end

    step = trunc(base * mag)
    step = if step <= 0, do: 1, else: step

    start_tick = trunc(:math.floor(axis_min / step)) * step
    end_tick = trunc(:math.ceil(axis_max / step)) * step

    Stream.iterate(start_tick, &(&1 + step))
    |> Enum.take_while(&(&1 <= end_tick))
  end
end
