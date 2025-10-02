defmodule Timeline.Periods do
  @moduledoc """
  Loads historical periods from a JSON file in `priv/`.

  The expected JSON format is either:

    1) A top-level list of period maps:
       [
         {"title": "...", "image_src": "...", "description": "...", "weblink": "...", "start_year": -3300, "end_year": -1200},
         ...
       ]

    2) Or wrapped under a `"periods"` key:
       {
         "periods": [
           {"title": "...", "image_src": "...", "description": "...", "weblink": "...", "start_year": -3300, "end_year": -1200},
           ...
         ]
       }

  Required keys per period:
    - `title` (string)
    - `description` (string)
    - `weblink` (string)
    - `start_year` (integer or stringified integer; may be negative)
    - `end_year` (integer or stringified integer; may be negative)

  Optional keys:
    - `image_src` (string) — `image` will be accepted as an alias

  Notes:
    - Years are parsed as integers. Negative values (BCE) are supported.
    - If `start_year` > `end_year`, the values are still accepted as-is to allow
      downstream UIs to decide how to handle such data.
  """

  @enforce_keys [:title, :description, :weblink, :start_year, :end_year]
  defstruct [:title, :image_src, :description, :weblink, :start_year, :end_year]

  @type t :: %__MODULE__{
          title: String.t(),
          image_src: String.t() | nil,
          description: String.t(),
          weblink: String.t(),
          start_year: integer(),
          end_year: integer()
        }

  @default_rel_path "data/periods.json"

  @doc """
  Loads periods from the default JSON file in `priv/data/periods.json`.

  Returns `{:ok, [Timeline.Periods.t()]}` or `{:error, reason}`.
  """
  @spec load() :: {:ok, [t()]} | {:error, term()}
  def load, do: load(@default_rel_path)

  @doc """
  Loads periods from a given path.

  - If `path` is absolute, it is used as-is.
  - If `path` is relative, it is treated as relative to the application priv directory.

  Returns `{:ok, [Timeline.Periods.t()]}` or `{:error, reason}`.
  """
  @spec load(Path.t()) :: {:ok, [t()]} | {:error, term()}
  def load(path) when is_binary(path) do
    resolved = resolve_path(path)

    with {:ok, contents} <- File.read(resolved),
         {:ok, json} <- Jason.decode(contents),
         {:ok, periods} <- parse_periods(json) do
      {:ok, periods}
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
  Loads periods and raises on error.

  Useful for boot-time scenarios where failures should halt startup.
  """
  @spec load!() :: [t()]
  def load! do
    case load() do
      {:ok, periods} -> periods
      {:error, reason} -> raise "Failed to load periods: #{inspect(reason)}"
    end
  end

  @doc """
  Loads periods from a provided path and raises on error.
  """
  @spec load!(Path.t()) :: [t()]
  def load!(path) when is_binary(path) do
    case load(path) do
      {:ok, periods} -> periods
      {:error, reason} -> raise "Failed to load periods (#{path}): #{inspect(reason)}"
    end
  end

  @doc """
  Returns the resolved absolute path to the default periods JSON file
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

  @spec parse_periods(any()) :: {:ok, [t()]} | {:error, term()}
  defp parse_periods(list) when is_list(list), do: build_periods(list)

  defp parse_periods(%{"periods" => list}) when is_list(list), do: build_periods(list)
  defp parse_periods(%{periods: list}) when is_list(list), do: build_periods(list)

  defp parse_periods(other),
    do:
      {:error,
       {:invalid_format,
        "expected a list or a 'periods' list, got: #{inspect(other, limit: 200)}"}}

  @spec build_periods([map()]) :: {:ok, [t()]} | {:error, term()}
  defp build_periods(list) do
    list
    |> Enum.reduce_while({:ok, []}, fn item, {:ok, acc} ->
      case to_period(item) do
        {:ok, period} -> {:cont, {:ok, [period | acc]}}
        {:error, reason} -> {:halt, {:error, reason}}
      end
    end)
    |> case do
      {:ok, acc} -> {:ok, Enum.reverse(acc)}
      {:error, _} = err -> err
    end
  end

  @spec to_period(map()) :: {:ok, t()} | {:error, term()}
  defp to_period(%{} = map) do
    title = get(map, :title) |> normalize_str()
    description = get(map, :description) |> normalize_str()
    weblink = get(map, :weblink) |> normalize_str()
    image_src = (get(map, :image_src) || get(map, :image)) |> normalize_str()
    start_year = get(map, :start_year) |> normalize_year()
    end_year = get(map, :end_year) |> normalize_year()

    cond do
      !is_binary(title) or title == "" ->
        {:error, {:invalid_period, :title_missing_or_invalid, map}}

      !is_binary(description) or description == "" ->
        {:error, {:invalid_period, :description_missing_or_invalid, map}}

      !is_binary(weblink) or weblink == "" ->
        {:error, {:invalid_period, :weblink_missing_or_invalid, map}}

      !is_integer(start_year) ->
        {:error, {:invalid_period, :start_year_missing_or_invalid, map}}

      !is_integer(end_year) ->
        {:error, {:invalid_period, :end_year_missing_or_invalid, map}}

      true ->
        {:ok,
         %__MODULE__{
           title: title,
           description: description,
           weblink: weblink,
           image_src: image_src,
           start_year: start_year,
           end_year: end_year
         }}
    end
  end

  defp to_period(other), do: {:error, {:invalid_period, :not_a_map, other}}

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
