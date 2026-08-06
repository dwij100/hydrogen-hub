"""Identity boundary for the packaged single-user desktop application."""

from __future__ import annotations

from dataclasses import dataclass

from fastapi import Depends, HTTPException, status

from .config import Settings, get_settings


@dataclass(frozen=True)
class AuthUser:
    id: str
    email: str | None = None


async def current_user(settings: Settings = Depends(get_settings)) -> AuthUser:
    if not settings.local_single_user_mode:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "code": "authentication_not_configured",
                "message": "This package supports local single-user mode only.",
            },
        )
    return AuthUser(id="local-user")
