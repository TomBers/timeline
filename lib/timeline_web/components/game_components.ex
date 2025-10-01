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
  attr :rest, :global

  def event_card(assigns) do
    ~H"""
    <div id={@id} class={["flex gap-3", @class]} {@rest}>
      <h3 class="font-semibold">
        {title(@event)}
      </h3>
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
end
