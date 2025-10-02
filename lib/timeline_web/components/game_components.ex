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
  attr :show_description, :boolean, default: true
  attr :summary_text, :string, default: "Show description"
  attr :rest, :global

  def event_card(assigns) do
    ~H"""
    <div id={@id} class={[@class]} {@rest}>
      <div class={["card-body p-4", @compact && "py-3 px-3"]}>
        <div :if={!@compact} class="flex items-center justify-between -mt-1 mb-2">
          <span class="inline-flex items-center gap-1 text-xs text-base-content/70">
            <.icon name="hero-bars-3-micro" class="w-4 h-4 opacity-60" /> Drag
          </span>
          <span class="text-[10px] text-base-content/50 uppercase tracking-wider">
            Card
          </span>
        </div>
        <h3 class={["font-semibold", @compact && "text-sm"]}>
          {title(@event)}
        </h3>

        <details
          :if={@show_description && description(@event)}
          class={[@compact && "mt-1 text-xs", !@compact && "mt-2 text-sm"]}
          draggable="false"
          ondragstart="event.stopPropagation()"
          onmousedown="event.stopPropagation()"
        >
          <summary class="cursor-pointer text-base-content/70 hover:text-base-content">
            {@summary_text}
          </summary>
          <p class={[@compact && "mt-1", !@compact && "mt-2", "text-base-content/80"]}>
            {description(@event)}
          </p>
        </details>
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

  defp weblink(event) do
    case normalize_str(get(event, :weblink)) do
      nil -> nil
      "http://" <> _ = url -> url
      "https://" <> _ = url -> url
      url -> url
    end
  end
end
