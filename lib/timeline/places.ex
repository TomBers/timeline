defmodule Timeline.Places do
  @moduledoc """
  Loads places for Geo mode from a JSON file in `priv/`.

  The expected JSON format is either:

    1) A top-level list of place maps:
       [
         {"title": "...", "image_src": "...", "description": "...", "weblink": "...", "latitude": 48.8566, "longitude": 2.3522},
         ...
       ]

    2) Or wrapped under a `"places"` key:
       {
         "places": [
           {"title": "...", "image_src": "...", "description": "...", "weblink": "...", "latitude": 48.8566, "longitude": 2.3522},
           ...
         ]
       }

  Required keys per place:
    - `title` (string) — also accepts `name`
    - `latitude` (float in -90..90) — also accepts `lat`
    - `longitude` (float in -180..180) — also accepts `lon`/`lng`

  Optional keys:
    - `image_src` (string) — also accepts `image`
    - `description` (string)
    - `weblink` (string)
  """

  @enforce_keys [:title, :latitude, :longitude]
  defstruct [:title, :image_src, :description, :weblink, :latitude, :longitude]

  @type t :: %__MODULE__{
          title: String.t(),
          image_src: String.t() | nil,
          description: String.t() | nil,
          weblink: String.t() | nil,
          latitude: float(),
          longitude: float()
        }

  @default_rel_path "data/places.json"

  @doc """
  Loads places from the default JSON file in `priv/data/places.json`.

  Returns `{:ok, [Timeline.Places.t()]}` or `{:error, reason}`.
  """
  @spec load() :: {:ok, [t()]} | {:error, term()}
  def load, do: load(@default_rel_path)

  @doc """
  Loads places from a given path.

  - If `path` is absolute, it is used as-is.
  - If `path` is relative, it is treated as relative to the application priv directory.

  Returns `{:ok, [Timeline.Places.t()]}` or `{:error, reason}`.
  """
  @spec load(Path.t()) :: {:ok, [t()]} | {:error, term()}
  def load(path) when is_binary(path) do
    resolved = resolve_path(path)

    with {:ok, contents} <- File.read(resolved),
         {:ok, json} <- Jason.decode(contents),
         {:ok, places} <- parse_places(json) do
      {:ok, places}
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
  Loads places and raises on error.
  """
  @spec load!() :: [t()]
  def load! do
    case load() do
      {:ok, places} -> places
      {:error, reason} -> raise "Failed to load places: #{inspect(reason)}"
    end
  end

  @doc """
  Loads places from a provided path and raises on error.
  """
  @spec load!(Path.t()) :: [t()]
  def load!(path) when is_binary(path) do
    case load(path) do
      {:ok, places} -> places
      {:error, reason} -> raise "Failed to load places (#{path}): #{inspect(reason)}"
    end
  end

  @doc """
  Returns the resolved absolute path to the configured places JSON file
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

        cleaned =
          if String.starts_with?(path, "priv/") do
            String.replace_prefix(path, "priv/", "")
          else
            path
          end

        Path.join(priv_dir, cleaned)
    end
  end

  @spec parse_places(any()) :: {:ok, [t()]} | {:error, term()}
  defp parse_places(list) when is_list(list), do: build_places(list)

  defp parse_places(%{"places" => list}) when is_list(list), do: build_places(list)
  defp parse_places(%{places: list}) when is_list(list), do: build_places(list)

  defp parse_places(other),
    do:
      {:error,
       {:invalid_format, "expected a list or a 'places' list, got: #{inspect(other, limit: 100)}"}}

  @spec build_places([map()]) :: {:ok, [t()]} | {:error, term()}
  defp build_places(list) do
    list
    |> Enum.reduce_while({:ok, []}, fn item, {:ok, acc} ->
      case to_place(item) do
        {:ok, place} -> {:cont, {:ok, [place | acc]}}
        {:error, reason} -> {:halt, {:error, reason}}
      end
    end)
    |> case do
      {:ok, acc} -> {:ok, Enum.reverse(acc)}
      {:error, _} = err -> err
    end
  end

  @spec to_place(map()) :: {:ok, t()} | {:error, term()}
  defp to_place(%{} = map) do
    title = get(map, :title) || get(map, :name)
    image_src = get(map, :image_src) || get(map, :image)
    description = get(map, :description)
    weblink = get(map, :weblink)

    lat = get(map, :latitude) || get(map, :lat)
    lon = get(map, :longitude) || get(map, :lon) || get(map, :lng)

    title = normalize_str(title)
    lat = normalize_float(lat)
    lon = normalize_float(lon)

    cond do
      !is_binary(title) or title == "" ->
        {:error, {:invalid_place, :title_missing_or_invalid, map}}

      !is_number(lat) or lat < -90.0 or lat > 90.0 ->
        {:error, {:invalid_place, :latitude_missing_or_invalid, map}}

      !is_number(lon) or lon < -180.0 or lon > 180.0 ->
        {:error, {:invalid_place, :longitude_missing_or_invalid, map}}

      true ->
        {:ok,
         %__MODULE__{
           title: title,
           image_src: normalize_str(image_src),
           description: normalize_str(description),
           weblink: normalize_str(weblink),
           latitude: lat * 1.0,
           longitude: lon * 1.0
         }}
    end
  end

  defp to_place(other),
    do: {:error, {:invalid_place, :not_a_map, other}}

  @spec get(map(), atom()) :: any()
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

  defp normalize_float(nil), do: nil
  defp normalize_float(v) when is_float(v), do: v
  defp normalize_float(v) when is_integer(v), do: v * 1.0

  defp normalize_float(v) when is_binary(v) do
    case Float.parse(v) do
      {f, _} ->
        f

      :error ->
        case Integer.parse(v) do
          {i, _} -> i * 1.0
          :error -> nil
        end
    end
  end

  defp normalize_float(_), do: nil
end
