defmodule Timeline.Application do
  # See https://hexdocs.pm/elixir/Application.html
  # for more information on OTP Applications
  @moduledoc false

  use Application
  require Logger

  @impl true
  def start(_type, _args) do
    skip_db = skip_db?()

    if skip_db do
      Logger.warning("SKIP_DB set: starting without database (Timeline.Repo disabled)")
    end

    children =
      [
        TimelineWeb.Telemetry,
        {DNSCluster, query: Application.get_env(:timeline, :dns_cluster_query) || :ignore},
        {Phoenix.PubSub, name: Timeline.PubSub},
        # Start a worker by calling: Timeline.Worker.start_link(arg)
        # {Timeline.Worker, arg},
        # Start to serve requests, typically the last entry
        TimelineWeb.Endpoint
      ] ++
        if skip_db do
          []
        else
          [Timeline.Repo]
        end

    # See https://hexdocs.pm/elixir/Supervisor.html
    # for other strategies and supported options
    opts = [strategy: :one_for_one, name: Timeline.Supervisor]
    Supervisor.start_link(children, opts)
  end

  defp skip_db? do
    case System.get_env("SKIP_DB") do
      v when is_binary(v) -> String.downcase(v) in ["1", "true", "yes"]
      _ -> false
    end
  end

  # Tell Phoenix to update the endpoint configuration
  # whenever the application is updated.
  @impl true
  def config_change(changed, _new, removed) do
    TimelineWeb.Endpoint.config_change(changed, removed)
    :ok
  end
end
