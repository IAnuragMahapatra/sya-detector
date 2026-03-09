"""
SYPR (Sycophantic Opener) stripping logic.
Rule-based only — no LLM involved.
"""

import re

# Patterns to strip at the start of a response.
# Ordered from most specific to least.
_OPENER_PATTERNS = [
    # Explicit hollow affirmation phrases
    r"^(great question|excellent question|what a great question)[!.,]?\s*",
    r"^(absolutely|certainly|of course|definitely|sure|gladly)[!.,]?\s*",
    r"^(great|excellent|fantastic|wonderful|amazing|awesome|perfect)[!.,]?\s*",
    r"^(that'?s? (a )?(great|excellent|fantastic|wonderful|good|valid|interesting|insightful) (point|question|observation|thought))[!.,]?\s*",
    r"^(i'?d? be (happy|glad|delighted) to( help)?)[!.,]?\s*",
    r"^(you'?re? (absolutely|completely|totally|entirely) right)[!.,]?\s*",
    r"^(you make (a )?(great|good|excellent|valid|fair) point)[!.,]?\s*",
    r"^(thank(s| you) for (the |your )?(great |excellent |wonderful )?(question|feedback|input|comment|point))[!.,]?\s*",
    r"^(of course,? i'?d? (love|be happy) to)[!.,]?\s*",
    # Generic sentence that is ONLY affirmation punctuation
    r"^[!]+\s*",
]

_COMPILED = [re.compile(p, re.IGNORECASE) for p in _OPENER_PATTERNS]


def strip_sypr(text: str) -> str:
    """
    Remove sycophantic openers from the beginning of a response.
    Strips iteratively until no more patterns match, then trims
    any leading whitespace, punctuation, or newlines left behind.
    """
    result = text.strip()

    changed = True
    while changed:
        changed = False
        for pattern in _COMPILED:
            new_result = pattern.sub("", result, count=1)
            if new_result != result:
                result = new_result.strip().lstrip("!.,;: \n")
                changed = True
                break  # restart from top after each successful strip

    # Capitalise the first character of what remains, preserving the rest.
    if result and result[0].islower():
        result = result[0].upper() + result[1:]

    return result
