defmodule Timeline.WikiImages do
  @moduledoc """
  Lightweight Wikipedia image fetcher with an ETS cache.

  Features:
  - Given a Wikipedia title or URL, fetch the first/lead image using the REST Summary API.
  - Caches results in ETS with TTL. Negative results (no image) are cached separately.
  - Optional background prefetch to hydrate the cache.
  - Optional GenServer to periodically prune expired entries.

  This module depends only on the built-in ETS and the Req HTTP client.

  Usage (without adding to supervision tree):
      Timeline.WikiImages.get_image_url("Ada Lovelace")
      Timeline.WikiImages.prefetch(["Ada Lovelace", "Alan Turing"])

  Optional supervision (enables periodic pruning):
      # In your application supervisor children:
      {Timeline.WikiImages, ttl: :timer.hours(24), negative_ttl: :timer.hours(6), prune_interval: :timer.minutes(30)}

  Options (for get_image_url/2 and prefetch/2):
    - `:lang` - Wikipedia language to query (default: "en")
    - `:ttl`  - cache TTL in milliseconds (default from server state or 86400000 ms, i.e., 24h)
    - `:negative_ttl` - TTL for "no image found" results in ms (default from server state or 21600000 ms, i.e., 6h)

  Returns:
    - `{:ok, image_url}` on success
    - `{:error, reason}` on failure
  """

  use GenServer

  @table :wiki_images_cache
  @server __MODULE__

  @default_ttl_ms 24 * 60 * 60 * 1000
  @default_negative_ttl_ms 6 * 60 * 60 * 1000
  @default_prune_interval_ms 30 * 60 * 1000
  @default_rl_limit 5
  @default_rl_window_ms 1_000

  @typedoc "A Wikipedia title (e.g., \"Ada Lovelace\") or a full article URL"
  @type title_or_url :: String.t()

  @typedoc "An absolute HTTPS URL pointing to an image"
  @type image_url :: String.t()

  @doc false
  def child_spec(opts) do
    %{
      id: @server,
      start: {@server, :start_link, [opts]},
      restart: :permanent,
      shutdown: 5000,
      type: :worker
    }
  end

  @doc """
  Starts the WikiImages server.

  You don't need to start this process to use the cache. The ETS table is created lazily
  on first use. Starting the process enables periodic pruning of expired entries.
  """
  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: @server)
  end

  @impl true
  def init(opts) do
    ensure_table!()

    state = %{
      ttl: Keyword.get(opts, :ttl, @default_ttl_ms),
      negative_ttl: Keyword.get(opts, :negative_ttl, @default_negative_ttl_ms),
      prune_interval: Keyword.get(opts, :prune_interval, @default_prune_interval_ms),
      rl_limit: Keyword.get(opts, :rl_limit, @default_rl_limit),
      rl_window_ms: Keyword.get(opts, :rl_window_ms, @default_rl_window_ms),
      rl_count: 0,
      rl_window_start: now_ms()
    }

    schedule_prune(state.prune_interval)
    {:ok, state}
  end

  @impl true
  def handle_info(:prune, state) do
    _deleted = prune_expired()
    schedule_prune(state.prune_interval)
    {:noreply, state}
  end

  @impl true
  def handle_call({:acquire, _kind}, _from, state) do
    now = now_ms()
    window_elapsed = now - state.rl_window_start

    {rl_count, rl_window_start} =
      if window_elapsed >= state.rl_window_ms do
        {0, now}
      else
        {state.rl_count, state.rl_window_start}
      end

    if rl_count < state.rl_limit do
      {:reply, :ok, %{state | rl_count: rl_count + 1, rl_window_start: rl_window_start}}
    else
      ms_to_reset = max(rl_window_start + state.rl_window_ms - now, 0)
      {:reply, {:wait, ms_to_reset}, state}
    end
  end

  @impl true
  def handle_call(:ensure_table, _from, state) do
    _ = create_table_owned()
    {:reply, :ok, state}
  end

  # -- Public API -------------------------------------------------------------

  @doc """
  Returns the lead image URL for a Wikipedia article, using cache if available.

  Accepts a page title like \"Ada Lovelace\" or a Wikipedia URL like:
  https://en.wikipedia.org/wiki/Ada_Lovelace

  Options:
    - `:lang` - Wikipedia language (default: \"en\")
    - `:ttl` - cache TTL in milliseconds (default: server ttl or #{@default_ttl_ms})
    - `:negative_ttl` - TTL for negative cache (default: server negative ttl or #{@default_negative_ttl_ms})
  """
  @spec get_image_url(title_or_url, keyword) :: {:ok, image_url} | {:error, term}
  def get_image_url(title_or_url, opts \\ []) when is_binary(title_or_url) do
    ensure_server_started()
    ensure_table!()

    lang = Keyword.get(opts, :lang, "en")
    ttl = Keyword.get(opts, :ttl, current_ttl())
    negative_ttl = Keyword.get(opts, :negative_ttl, current_negative_ttl())

    title = normalize_title(title_or_url)
    key = cache_key(lang, title)

    case cache_lookup(key) do
      {:hit, {:ok, url}} ->
        {:ok, url}

      {:hit, {:error, reason}} ->
        {:error, reason}

      :miss ->
        # Not cached or expired, fetch and store
        case fetch_image_url(lang, title) do
          {:ok, url} ->
            cache_put(key, {:ok, url}, ttl)
            {:ok, url}

          {:error, reason} ->
            cache_put(key, {:error, reason}, negative_ttl)
            {:error, reason}
        end
    end
  end

  @doc """
  Background prefetch for a single title/URL or a list of titles/URLs.

  Returns `:ok` immediately. Each item will be fetched and cached in the background.
  """
  @spec prefetch(title_or_url | [title_or_url], keyword) :: :ok
  def prefetch(items, opts \\ [])

  def prefetch(items, opts) when is_list(items) do
    Enum.each(items, fn item -> prefetch(item, opts) end)
    :ok
  end

  def prefetch(item, opts) when is_binary(item) do
    # Don't overwhelm external service: light background task
    _ = Task.start(fn -> _ = get_image_url(item, opts) end)
    :ok
  end

  @doc """
  Clears a specific cached entry (by title/URL) or the whole cache with `:all`.
  """
  @spec clear(title_or_url | :all) :: :ok
  def clear(:all) do
    ensure_table!()

    try do
      :ets.delete_all_objects(@table)
    rescue
      ArgumentError ->
        ensure_table!()
        :ets.delete_all_objects(@table)
    end

    :ok
  end

  def clear(title_or_url) when is_binary(title_or_url) do
    ensure_table!()
    lang = "en"
    title = normalize_title(title_or_url)
    key = cache_key(lang, title)

    try do
      :ets.delete(@table, key)
    rescue
      ArgumentError ->
        ensure_table!()
        :ets.delete(@table, key)
    end

    :ok
  end

  # -- Internal: Cache --------------------------------------------------------

  @spec ensure_table!() :: :ok
  defp ensure_table!() do
    case :ets.whereis(@table) do
      :undefined ->
        # If we are inside the WikiImages server process, avoid GenServer.call to self.
        case Process.whereis(@server) do
          pid when pid == self() ->
            create_table_owned()
            :ok

          _other ->
            ensure_server_started()
            GenServer.call(@server, :ensure_table)
            :ok
        end

      _tid ->
        :ok
    end
  end

  defp create_table_owned() do
    case :ets.whereis(@table) do
      :undefined ->
        _tid =
          :ets.new(@table, [
            :named_table,
            :set,
            :public,
            {:read_concurrency, true},
            {:write_concurrency, true}
          ])

        :ok

      _tid ->
        :ok
    end
  end

  defp schedule_prune(interval_ms) do
    Process.send_after(self(), :prune, interval_ms)
  end

  @spec now_ms() :: non_neg_integer()
  defp now_ms, do: System.system_time(:millisecond)

  defp ensure_server_started() do
    case Process.whereis(@server) do
      nil ->
        _ = GenServer.start_link(__MODULE__, [], name: @server)
        :ok

      _pid ->
        :ok
    end
  end

  @doc """
  Acquire a rate-limit token. Returns :ok or {:wait, ms_to_wait}.
  """
  def acquire(kind \\ :default) do
    ensure_server_started()
    GenServer.call(@server, {:acquire, kind})
  end

  @spec cache_lookup(term) :: {:hit, term} | :miss
  defp cache_lookup(key) do
    try do
      case :ets.lookup(@table, key) do
        [{^key, result, expires_at_ms}] ->
          if expires_at_ms > now_ms() do
            {:hit, result}
          else
            # Expired; evict and report miss
            :ets.delete(@table, key)
            :miss
          end

        [] ->
          :miss
      end
    rescue
      ArgumentError ->
        ensure_table!()
        :miss
    end
  end

  @spec cache_put(term, term, non_neg_integer()) :: true
  defp cache_put(key, result, ttl_ms) do
    expires_at = now_ms() + ttl_ms

    try do
      :ets.insert(@table, {key, result, expires_at})
    rescue
      ArgumentError ->
        ensure_table!()
        :ets.insert(@table, {key, result, expires_at})
    end
  end

  @spec prune_expired() :: non_neg_integer()
  defp prune_expired() do
    now = now_ms()

    match_spec = [
      {
        {:"$1", :"$2", :"$3"},
        [{:<, :"$3", now}],
        [true]
      }
    ]

    try do
      :ets.select_delete(@table, match_spec)
    rescue
      ArgumentError ->
        ensure_table!()
        :ets.select_delete(@table, match_spec)
    end
  end

  @spec current_ttl() :: non_neg_integer()
  defp current_ttl() do
    case Process.whereis(@server) do
      pid when is_pid(pid) ->
        %{ttl: ttl} = :sys.get_state(@server)
        ttl

      _ ->
        @default_ttl_ms
    end
  end

  @spec current_negative_ttl() :: non_neg_integer()
  defp current_negative_ttl() do
    case Process.whereis(@server) do
      pid when is_pid(pid) ->
        %{negative_ttl: ttl} = :sys.get_state(@server)
        ttl

      _ ->
        @default_negative_ttl_ms
    end
  end

  # -- Internal: Fetching -----------------------------------------------------

  @doc false
  @spec fetch_image_url(String.t(), String.t()) :: {:ok, image_url} | {:error, term}
  defp fetch_image_url(lang, title) do
    ensure_server_started()

    # Simple fixed-window rate limiting with backoff
    case acquire(:wiki_fetch) do
      :ok ->
        :ok

      {:wait, ms} ->
        Process.sleep(ms)

        :ok =
          case acquire(:wiki_fetch) do
            :ok ->
              :ok

            {:wait, ms2} ->
              Process.sleep(ms2)
              :ok
          end
    end

    url = summary_endpoint(lang, title)

    headers = [
      {"accept", "application/json"},
      {"user-agent", user_agent()}
    ]

    # Keep timeouts low to remain "lightweight"
    req_opts = [
      url: url,
      headers: headers,
      receive_timeout: 5_000,
      connect_options: [timeout: 5_000]
    ]

    case Req.get(req_opts) do
      {:ok, %Req.Response{status: 200, body: body}} ->
        case extract_image_url(body) do
          nil -> {:error, :no_image_found}
          img -> {:ok, ensure_https(img)}
        end

      {:ok, %Req.Response{status: status}} ->
        {:error, {:http_error, status}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  # Prefer original image, else thumbnail from REST Summary
  @spec extract_image_url(map) :: image_url | nil
  defp extract_image_url(body) when is_map(body) do
    case body do
      %{"originalimage" => %{"source" => src}} when is_binary(src) ->
        src

      _ ->
        case get_in(body, ["thumbnail", "source"]) do
          src when is_binary(src) -> src
          _ -> nil
        end
    end
  end

  # -- Helpers ----------------------------------------------------------------

  @spec normalize_title(title_or_url) :: String.t()
  defp normalize_title(input) do
    input = String.trim(input)

    case URI.new(input) do
      {:ok, %URI{scheme: scheme, host: host, path: path}} when scheme in ["http", "https"] ->
        if host && String.contains?(host, "wikipedia.org") && is_binary(path) do
          case String.split(path, "/wiki/", parts: 2) do
            [_, page] ->
              page
              |> URI.decode()
              |> String.replace("_", " ")
              |> String.trim()

            _ ->
              # Could be a non-canonical path, fallback to input text
              fallback_title(input)
          end
        else
          fallback_title(input)
        end

      _ ->
        fallback_title(input)
    end
  end

  defp fallback_title(text) do
    text
    |> String.trim()
    |> String.replace(~r/\s+/, " ")
  end

  @spec summary_endpoint(String.t(), String.t()) :: String.t()
  defp summary_endpoint(lang, title) do
    encoded =
      title
      |> String.replace(" ", "_")
      |> URI.encode(&URI.char_unreserved?/1)

    "https://#{lang}.wikipedia.org/api/rest_v1/page/summary/#{encoded}"
  end

  @spec ensure_https(String.t()) :: String.t()
  defp ensure_https("//" <> rest), do: "https://" <> rest
  defp ensure_https("http://" <> rest), do: "https://" <> rest
  defp ensure_https(url), do: url

  @spec cache_key(String.t(), String.t()) :: term
  defp cache_key(lang, title) do
    {:wiki, String.downcase(lang), String.downcase(title)}
  end

  defp user_agent do
    app =
      case :application.get_application() do
        {:ok, app} -> to_string(app)
        _ -> "timeline"
      end

    vsn =
      case :application.get_key(:timeline, :vsn) do
        {:ok, v} -> to_string(v)
        _ -> "dev"
      end

    "#{app}/#{vsn} (+https://#{app}.local) Req"
  end

  # -- Stringification helpers for moduledoc ---------------------------------
end
