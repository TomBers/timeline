defmodule Timeline.Events do
  @moduledoc """
  Loads historical events from a JSON file in `priv/`.

  The expected JSON format is either:

    1) A top-level list of event maps:
       [
         {"title": "...", "image_src": "...", "description": "...", "weblink": "..."},
         ...
       ]

    2) Or wrapped under an `"events"` key:
       {
         "events": [
           {"title": "...", "image_src": "...", "description": "...", "weblink": "..."},
           ...
         ]
       }

  Required keys per event:
    - `title` (string)
    - `description` (string)
    - `weblink` (string)

  Optional keys:
    - `image_src` (string)
  """

  @enforce_keys [:title, :description, :weblink]
  defstruct [:title, :image_src, :description, :weblink, :year]

  @type t :: %__MODULE__{
          title: String.t(),
          image_src: String.t() | nil,
          description: String.t(),
          weblink: String.t(),
          year: integer() | nil
        }

  @default_rel_path "data/events.json"

  @doc """
  Loads events from the default JSON file in `priv/data/events.json`.

  Returns `{:ok, [Timeline.Events.t()]}` or `{:error, reason}`.
  """
  @spec load() :: {:ok, [t()]} | {:error, term()}
  def load, do: load(@default_rel_path)

  @doc """
  Loads events from a given path.

  - If `path` is absolute, it is used as-is.
  - If `path` is relative, it is treated as relative to the application priv directory.

  Returns `{:ok, [Timeline.Events.t()]}` or `{:error, reason}`.
  """
  @spec load(Path.t()) :: {:ok, [t()]} | {:error, term()}
  def load(path) when is_binary(path) do
    resolved = resolve_path(path)

    with {:ok, contents} <- File.read(resolved),
         {:ok, json} <- Jason.decode(contents),
         {:ok, events} <- parse_events(json) do
      {:ok, events}
    else
      {:error, %Jason.DecodeError{} = decode_err} ->
        {:error, {:invalid_json, decode_err}}

      {:error, :enoent} ->
        {:error, {:file_not_found, resolved}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  @doc """
  Loads events and raises on error.

  Useful in boot-time scenarios where failures should halt startup.
  """
  @spec load!() :: [t()]
  def load! do
    case load() do
      {:ok, events} -> events
      {:error, reason} -> raise "Failed to load events: #{inspect(reason)}"
    end
  end

  @doc """
  Loads events from a provided path and raises on error.
  """
  @spec load!(Path.t()) :: [t()]
  def load!(path) when is_binary(path) do
    case load(path) do
      {:ok, events} -> events
      {:error, reason} -> raise "Failed to load events (#{path}): #{inspect(reason)}"
    end
  end

  @doc """
  Returns the resolved absolute path to the configured events JSON file
  inside the application priv directory.
  """
  @spec default_path() :: Path.t()
  def default_path, do: resolve_path(@default_rel_path)

  # -- INTERNALS --------------------------------------------------------------

  @spec resolve_path(Path.t()) :: Path.t()
  defp resolve_path(path) do
    case Path.type(path) do
      :absolute ->
        path

      :relative ->
        priv_dir = :code.priv_dir(:timeline) |> to_string()

        # Join relative paths under priv. If a caller provides a path with a leading
        # "priv/", strip it to avoid "priv/priv" duplication.
        cleaned =
          if String.starts_with?(path, "priv/") do
            String.replace_prefix(path, "priv/", "")
          else
            path
          end

        Path.join(priv_dir, cleaned)
    end
  end

  @spec parse_events(any()) :: {:ok, [t()]} | {:error, term()}
  defp parse_events(list) when is_list(list), do: build_events(list)

  defp parse_events(%{"events" => list}) when is_list(list), do: build_events(list)
  defp parse_events(%{events: list}) when is_list(list), do: build_events(list)

  defp parse_events(other),
    do: {:error, {:invalid_format, "expected a list or an 'events' list, got: #{inspect(other)}"}}

  @spec build_events([map()]) :: {:ok, [t()]} | {:error, term()}
  defp build_events(list) do
    list
    |> Enum.reduce_while({:ok, []}, fn item, {:ok, acc} ->
      case to_event(item) do
        {:ok, event} -> {:cont, {:ok, [event | acc]}}
        {:error, reason} -> {:halt, {:error, reason}}
      end
    end)
    |> case do
      {:ok, acc} -> {:ok, Enum.reverse(acc)}
      {:error, _} = err -> err
    end
  end

  @spec to_event(map()) :: {:ok, t()} | {:error, term()}
  defp to_event(%{} = map) do
    title = get(map, :title)
    description = get(map, :description)
    weblink = get(map, :weblink)

    cond do
      !is_binary(title) or title == "" ->
        {:error, {:invalid_event, :title_missing_or_invalid, map}}

      !is_binary(description) or description == "" ->
        {:error, {:invalid_event, :description_missing_or_invalid, map}}

      !is_binary(weblink) or weblink == "" ->
        {:error, {:invalid_event, :weblink_missing_or_invalid, map}}

      true ->
        image_src = get(map, :image_src) || get(map, :image)
        year = normalize_year(get(map, :year))

        {:ok,
         %__MODULE__{
           title: title,
           image_src: normalize_str(image_src),
           description: description,
           weblink: weblink,
           year: year
         }}
    end
  end

  defp to_event(other),
    do: {:error, {:invalid_event, :not_a_map, other}}

  @spec get(map(), atom()) :: any()
  defp get(map, key) when is_atom(key) do
    Map.get(map, key) || Map.get(map, Atom.to_string(key))
  end

  defp normalize_str(nil), do: nil
  defp normalize_str(v) when is_binary(v), do: v
  defp normalize_str(_), do: nil

  defp normalize_year(nil), do: nil
  defp normalize_year(y) when is_integer(y), do: y

  defp normalize_year(y) when is_binary(y) do
    case Integer.parse(y) do
      {i, _} -> i
      :error -> nil
    end
  end

  defp normalize_year(_), do: nil
end
