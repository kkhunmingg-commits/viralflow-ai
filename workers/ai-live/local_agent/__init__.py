"""ViralFlow's loopback-only AI LIVE agent foundation.

The installed desktop application supplies AgentConfig and calls serve_agent.
No production presenter or encoder is selected until NVIDIA validation is done.
"""

from .agent import AgentConfig, AgentError, LocalAgent, WorkerBoundary
from .http_server import AgentHTTPServer, serve_agent
from presenter import MuseTalkPresenter as MuseTalkLocalPresenter, PresenterProvider

__all__ = ["AgentConfig", "AgentError", "LocalAgent", "WorkerBoundary", "AgentHTTPServer",
           "serve_agent", "MuseTalkLocalPresenter", "PresenterProvider"]
