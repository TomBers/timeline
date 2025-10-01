defmodule TimelineWeb.PageController do
  use TimelineWeb, :controller

  def home(conn, _params) do
    render(conn, :home)
  end
end
