defmodule Timeline.Release do
  @moduledoc """
  Used for executing DB release tasks when run in production without Mix
  installed.
  """
  @app :timeline

  def migrate do
    load_app()

    if System.get_env("SKIP_DB") in ~w(true 1 yes YES True TRUE) do
      IO.puts("SKIP_DB set: skipping migrations")
      :ok
    else
      for repo <- repos() do
        {:ok, _, _} = Ecto.Migrator.with_repo(repo, &Ecto.Migrator.run(&1, :up, all: true))
      end
    end
  end

  def rollback(repo, version) do
    load_app()

    if System.get_env("SKIP_DB") in ~w(true 1 yes YES True TRUE) do
      IO.puts("SKIP_DB set: skipping rollback")
      :ok
    else
      {:ok, _, _} = Ecto.Migrator.with_repo(repo, &Ecto.Migrator.run(&1, :down, to: version))
    end
  end

  defp repos do
    Application.fetch_env!(@app, :ecto_repos)
  end

  defp load_app do
    # Many platforms require SSL when connecting to the database
    Application.ensure_all_started(:ssl)
    Application.ensure_loaded(@app)
  end
end
