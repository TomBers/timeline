defmodule TimelineWeb.GameComponents do
  @moduledoc """
  Function components for the Timeline game UI.

  Extracted shared UI pieces to keep LiveViews lean and focused on state/events.
  """
  use TimelineWeb, :html

  @doc """
  Renders a single event card.

  Accepts either a plain map with string/atom keys or a `%Timeline.Events{}` struct.

  Examples:

      <.event_card event={event} />
      <.event_card event={event} compact />
      <.event_card event={event} class="border p-2 rounded" />

  Optional attributes:
    - `compact` - renders a smaller visual variant (default: false)
    - `class` - extra classes applied to the root element
    - `id` - DOM id
    - `show_link` - toggles the "Learn more" link (default: true)
    - `link_target` - target for the "Learn more" link (default: "_blank")
  """
  attr :event, :map, required: true, doc: "An event map or struct"
  attr :compact, :boolean, default: false
  attr :class, :any, default: nil
  attr :id, :string, default: nil
  attr :show_link, :boolean, default: true
  attr :link_target, :string, default: "_blank"
  attr :wrap_body, :boolean, default: true
  attr :show_description, :boolean, default: true
  attr :summary_text, :string, default: "Show description"
  attr :rest, :global

  def event_card(assigns) do
    ~H"""
    <div id={@id} class={[@class]} {@rest}>
      <div class={[@wrap_body && "card-body p-4", @compact && "py-3 px-3"]}>
        <div :if={!@compact} class="flex items-center justify-between -mt-1 mb-2">
          <span class="inline-flex items-center gap-1 text-xs text-base-content/70">
            <.icon name="hero-bars-3-micro" class="w-4 h-4 opacity-60" /> Drag
          </span>
          <span class="text-[10px] text-base-content/50 uppercase tracking-wider">
            Card
          </span>
        </div>
        <figure :if={image_src(@event)} class={[@compact && "mb-1", !@compact && "mb-2"]}>
          <img
            src={image_src(@event)}
            alt={title(@event)}
            class={[
              "w-full rounded",
              @compact && "max-h-24 object-cover",
              !@compact && "max-h-40 object-cover"
            ]}
            loading="lazy"
            referrerpolicy="no-referrer"
          />
        </figure>
        <figure :if={!image_src(@event)} class={[@compact && "mb-1", !@compact && "mb-2"]}>
          <div class={[
            "w-full rounded bg-base-300 flex items-center justify-center text-base-content/60",
            @compact && "h-24",
            !@compact && "h-40"
          ]}>
            <.icon name="hero-photo" class="w-6 h-6 opacity-50" />
          </div>
        </figure>
        <h3 class={["font-semibold", @compact && "text-sm"]}>
          {title(@event)}
        </h3>

        <div
          :if={@show_description && description(@event)}
          class={[
            "collapse collapse-arrow mt-2 border border-base-300 bg-base-100 rounded",
            @compact && "text-xs",
            !@compact && "text-sm"
          ]}
          draggable="false"
          ondragstart="event.stopPropagation()"
          onmousedown="event.stopPropagation()"
        >
          <input type="checkbox" />
          <div class="collapse-title px-0">
            {@summary_text}
          </div>
          <div class="collapse-content px-0">
            <p class={[@compact && "mt-1", !@compact && "mt-2", "text-base-content/80"]}>
              {description(@event)}
            </p>
          </div>
        </div>
      </div>
    </div>
    """
  end

  # -- helpers ---------------------------------------------------------------

  # Extracts a field by atom or string key
  defp get(map, key) when is_atom(key) do
    Map.get(map, key) || Map.get(map, Atom.to_string(key))
  end

  defp normalize_str(nil), do: nil

  defp normalize_str(v) when is_binary(v) do
    case String.trim(v) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  defp normalize_str(_), do: nil

  defp title(event) do
    normalize_str(get(event, :title)) || "Untitled"
  end

  defp description(event) do
    normalize_str(get(event, :description))
  end

  defp image_src(event) do
    url = normalize_str(get(event, :image_src)) || normalize_str(get(event, :image))
    if is_placeholder?(url), do: nil, else: url
  end

  defp is_placeholder?(url) when is_binary(url), do: String.contains?(url, "via.placeholder.com")
  defp is_placeholder?(_), do: false

  # defp weblink(event) do
  #   case normalize_str(get(event, :weblink)) do
  #     nil -> nil
  #     "http://" <> _ = url -> url
  #     "https://" <> _ = url -> url
  #     url -> url
  #   end
  # end
end
