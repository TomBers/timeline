defmodule Timeline.Repo do
  use Ecto.Repo,
    otp_app: :timeline,
    adapter: Ecto.Adapters.Postgres
end
