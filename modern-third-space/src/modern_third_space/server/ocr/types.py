"""Shared types for ammo digit OCR."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class OcrRoi:
    """Prepared BGRA crop passed to every digit engine."""

    bgra: bytes
    width: int
    height: int

    def inverted(self) -> "OcrRoi":
        from .preprocess import invert_roi

        return invert_roi(self)


class DigitOcrBackend(ABC):
    """One OCR implementation. `read_number` must return an int or None."""

    id: str
    label: str
    beta: bool = True
    group: str = "other"
    description: str = ""
    install: str = ""
    # Shown on Daemon Settings. False = kept for CLI eval / future versions only.
    offered_in_ui: bool = False
    ui_summary: str = ""
    # Cap preprocess variants for slow engines (None = try all).
    max_roi_variants: Optional[int] = None

    def unavailable_reason(self) -> Optional[str]:
        return None

    def as_catalog(self) -> dict:
        return {
            "id": self.id,
            "label": self.label,
            "beta": self.beta,
            "group": self.group,
            "description": self.description,
            "install": self.install,
            "offered_in_ui": self.offered_in_ui,
            "ui_summary": self.ui_summary,
        }

    def recognize_text(self, roi: OcrRoi) -> str:
        """
        Optional raw OCR text for diagnostics / parsing.

        Text engines should override this. Default is empty (number-only backends).
        """
        return ""

    @abstractmethod
    def read_number(self, roi: OcrRoi) -> Optional[int]:
        """Return the integer shown in the ROI, or None if unreadable."""
