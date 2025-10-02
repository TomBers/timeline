defmodule TimelineWeb.PeriodsLive do
  use TimelineWeb, :live_view

  alias Timeline.Periods
  alias Timeline.WikiImages

  @min_round_size 3
  @max_round_size 20
  @default_round_size 6
  @min_duration_years 1

  @impl true
  def mount(params, _session, socket) do
    {periods_by_id, order, axis_min, axis_max} = new_game(params)
    start_image_prefetch(periods_by_id)

    {:ok,
     socket
     |> assign(:axis_min, axis_min)
     |> assign(:axis_max, axis_max)
     |> assign(:periods_by_id, periods_by_id)
     |> assign(:order, order)
     |> assign(:score, nil)
     |> assign(:show_truth, false)}
  end

  @impl true
  def render(assigns) do
    ~H"""
    <Layouts.app flash={@flash}>
      <div id="periods-root" class="space-y-6">
        <header class="space-y-2">
          <h1 class="text-2xl font-bold">Timeline — Periods Mode</h1>
          <p class="text-base text-base-content/70">
            For each row, position and scale the bar so it matches the real historic period on the master axis. Then click Score.
          </p>
        </header>

        <section aria-label="controls" class="flex flex-wrap gap-3 items-center">
          <button id="score-btn" class="btn btn-primary" phx-click="score">Score</button>
          <button id="reset-btn" class="btn" phx-click="reset">New game</button>
          <button
            id="toggle-truth-btn"
            class={["btn", @show_truth && "btn-warning", !@show_truth && "btn-ghost"]}
            phx-click="toggle_truth"
          >
            <%= if @show_truth do %>
              Hide answers
            <% else %>
              Show answers
            <% end %>
          </button>

          <div class="ml-auto text-sm text-base-content/70">
            Master axis: {format_year(@axis_min)} → {format_year(@axis_max)} ({@axis_max - @axis_min} years)
          </div>
        </section>

        <%= if @score do %>
          <section aria-label="score" id="score-panel" class="rounded-box bg-base-200 p-4">
            <div class="flex flex-wrap gap-6 items-center">
              <div>
                <div class="text-3xl font-extrabold">{@score.avg_iou_pct}%</div>
                <div class="text-sm text-base-content/70">Average overlap accuracy</div>
              </div>
              <div>
                <div class="text-xl font-semibold">{@score.mean_abs_start_err} yrs</div>
                <div class="text-sm text-base-content/70">Avg start error</div>
              </div>
              <div>
                <div class="text-xl font-semibold">{@score.mean_abs_end_err} yrs</div>
                <div class="text-sm text-base-content/70">Avg end error</div>
              </div>
              <div>
                <div class="text-xl font-semibold">{@score.perfect_count} / {@score.total}</div>
                <div class="text-sm text-base-content/70">Perfect matches</div>
              </div>
            </div>
          </section>
        <% end %>

        <section aria-label="rows" class="space-y-4">
          <div class="rounded-box bg-base-200 p-3">
            <div class="relative h-6">
              <div class="absolute inset-x-0 top-2 h-1 bg-base-300 rounded" />
              <div class="absolute left-0 -top-1 text-xs">{format_year(@axis_min)}</div>
              <div class="absolute right-0 -top-1 text-xs">{format_year(@axis_max)}</div>
            </div>
          </div>

          <%= for id <- @order do %>
            <% p = @periods_by_id[id] %>

            <% left_pct = pos_pct(@axis_min, @axis_max, p.guess_start) %>
            <% width_pct = len_pct(@axis_min, @axis_max, p.guess_start, p.guess_end) %>
            <% truth_left_pct = pos_pct(@axis_min, @axis_max, p.start_year) %>
            <% truth_width_pct = len_pct(@axis_min, @axis_max, p.start_year, p.end_year) %>
            <div id={"row-#{id}"} class="card bg-base-100 border-2 border-base-300">
              <div class="card-body p-4 space-y-3">
                <div class="flex items-start gap-3">
                  <figure :if={p.image_src} class="w-24 shrink-0">
                    <img
                      src={p.image_src}
                      alt={p.title}
                      class="rounded w-24 h-16 object-cover"
                      loading="lazy"
                      referrerpolicy="no-referrer"
                    />
                  </figure>
                  <div class="min-w-0">
                    <div class="font-semibold">{p.title}</div>
                    <p :if={p.description} class="text-xs text-base-content/70 line-clamp-2">
                      {p.description}
                    </p>
                  </div>
                </div>

                <div
                  id={"track-#{id}"}
                  class="relative rounded bg-base-200 border border-base-300 h-12 overflow-hidden"
                  phx-hook="PeriodRange"
                  data-axis-min={@axis_min}
                  data-axis-max={@axis_max}
                  data-id={id}
                  data-guess-start={p.guess_start}
                  data-guess-end={p.guess_end}
                >
                  <div class="absolute inset-x-0 top-5 h-px bg-base-300" />

                  <div
                    :if={@show_truth}
                    class="absolute top-1/2 -translate-y-1/2 h-6 border-2 border-warning/80 bg-warning/10 rounded flex items-center"
                    style={"left: #{truth_left_pct}%; width: #{truth_width_pct}%; min-width: 2px"}
                    title="Correct range"
                  >
                    <div class="w-2 h-full bg-warning/80 rounded-l" />
                    <div class="w-2 h-full bg-warning/80 rounded-r ml-auto" />
                  </div>

                  <div
                    class="absolute top-1/2 -translate-y-1/2 h-8 bg-primary/80 rounded text-primary-content flex items-center shadow"
                    style={"left: #{left_pct}%; width: #{width_pct}%; min-width: 6px"}
                    data-role="guess"
                    data-id={id}
                    title="Drag to move, drag handles to resize"
                  >
                    <div
                      class="w-3 h-full bg-primary/90 rounded-l cursor-ew-resize"
                      data-role="handle"
                      data-edge="start"
                      title="Drag to adjust start"
                    />
                    <div class="px-2 text-xs whitespace-nowrap overflow-hidden text-ellipsis">
                      Guess: {format_year(p.guess_start)} → {format_year(p.guess_end)}
                    </div>
                    <div
                      class="w-3 h-full bg-primary/90 rounded-r ml-auto cursor-ew-resize"
                      data-role="handle"
                      data-edge="end"
                      title="Drag to adjust end"
                    />
                  </div>
                </div>

                <div class="flex flex-wrap gap-2 items-center justify-between">
                  <div class="flex gap-2 items-center">
                    <button
                      class="btn btn-xs"
                      phx-click="nudge"
                      phx-value-id={id}
                      phx-value-delta="-10"
                    >
                      ← 10y
                    </button>
                    <button
                      class="btn btn-xs"
                      phx-click="nudge"
                      phx-value-id={id}
                      phx-value-delta="-1"
                    >
                      ← 1y
                    </button>
                    <button class="btn btn-xs" phx-click="nudge" phx-value-id={id} phx-value-delta="1">
                      1y →
                    </button>
                    <button
                      class="btn btn-xs"
                      phx-click="nudge"
                      phx-value-id={id}
                      phx-value-delta="10"
                    >
                      10y →
                    </button>
                  </div>

                  <div class="flex gap-2 items-center">
                    <button
                      class="btn btn-xs btn-ghost"
                      phx-click="resize"
                      phx-value-id={id}
                      phx-value-edge="start"
                      phx-value-delta="-1"
                      title="Extend start earlier"
                    >
                      start -
                    </button>
                    <button
                      class="btn btn-xs btn-ghost"
                      phx-click="resize"
                      phx-value-id={id}
                      phx-value-edge="start"
                      phx-value-delta="1"
                      title="Move start later"
                    >
                      start +
                    </button>
                    <button
                      class="btn btn-xs btn-ghost"
                      phx-click="resize"
                      phx-value-id={id}
                      phx-value-edge="end"
                      phx-value-delta="-1"
                      title="Move end earlier"
                    >
                      end -
                    </button>
                    <button
                      class="btn btn-xs btn-ghost"
                      phx-click="resize"
                      phx-value-id={id}
                      phx-value-edge="end"
                      phx-value-delta="1"
                      title="Extend end later"
                    >
                      end +
                    </button>
                  </div>

                  <div class="flex gap-2 items-center text-xs text-base-content/70">
                    <span>Fallback sliders:</span>
                    <form
                      phx-change="set_guess"
                      phx-debounce="150"
                      phx-value-id={id}
                      class="flex gap-2 items-center"
                    >
                      <input
                        type="range"
                        id={"range-start-#{id}"}
                        name="guess_start"
                        value={p.guess_start}
                        min={@axis_min}
                        max={p.guess_end - 1}
                        step="1"
                      />
                      <input
                        type="range"
                        id={"range-end-#{id}"}
                        name="guess_end"
                        value={p.guess_end}
                        min={p.guess_start + 1}
                        max={@axis_max}
                        step="1"
                      />
                    </form>
                  </div>
                </div>
              </div>
            </div>
          <% end %>
        </section>
      </div>
    </Layouts.app>
    """
  end

  @impl true
  def handle_event("reset", _params, socket) do
    size = socket.assigns.order |> length()
    {periods_by_id, order, axis_min, axis_max} = new_game(%{"size" => size})
    start_image_prefetch(periods_by_id)

    {:noreply,
     socket
     |> assign(:axis_min, axis_min)
     |> assign(:axis_max, axis_max)
     |> assign(:periods_by_id, periods_by_id)
     |> assign(:order, order)
     |> assign(:score, nil)
     |> assign(:show_truth, false)}
  end

  def handle_event("toggle_truth", _params, socket) do
    {:noreply, assign(socket, :show_truth, !socket.assigns.show_truth)}
  end

  def handle_event("nudge", %{"id" => id, "delta" => delta_str}, socket) do
    delta = parse_int(delta_str, 0)

    updated =
      update_guess(socket.assigns.periods_by_id, id, fn p ->
        move_guess(p, delta, socket.assigns.axis_min, socket.assigns.axis_max)
      end)

    {:noreply, socket |> assign(:periods_by_id, updated) |> assign(:score, nil)}
  end

  def handle_event("resize", %{"id" => id, "edge" => edge, "delta" => delta_str}, socket) do
    delta = parse_int(delta_str, 0)

    updated =
      update_guess(socket.assigns.periods_by_id, id, fn p ->
        resize_guess(p, edge, delta, socket.assigns.axis_min, socket.assigns.axis_max)
      end)

    {:noreply, socket |> assign(:periods_by_id, updated) |> assign(:score, nil)}
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

    {:noreply, socket |> assign(:periods_by_id, updated) |> assign(:score, nil)}
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
        updated = Map.put(socket.assigns.periods_by_id, id, Map.put(period, :image_src, url))
        {:noreply, assign(socket, :periods_by_id, updated)}
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

    sample =
      base_periods
      |> Enum.take_random(size)
      |> Enum.sort_by(fn p -> {p.start_year, p.end_year, p.title} end)

    axis_min =
      sample
      |> Enum.map(& &1.start_year)
      |> Enum.min(fn -> 0 end)

    axis_max =
      sample
      |> Enum.map(& &1.end_year)
      |> Enum.max(fn -> 1 end)

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

    {periods_by_id, order, axis_min, axis_max}
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
end
