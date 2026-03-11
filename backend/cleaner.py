# SYPR (Sycophantic Opener) stripping logic.

import re

# Patterns to strip at the start of a response.
# Ordered from most specific to least.
_OPENER_PATTERNS = [
    # Apologies and corrections (often precede sycophantic agreement)
    r"^(i apologize|my apologies|i'?m sorry|sorry)( for (the |any )?(confusion|misunderstanding|error|mistake|oversight))?[!.,]?\s*",
    r"^(thank(s| you) for (catching|pointing) that( out)?)[!.,]?\s*",
    # Expressions of complete agreement
    r"^(you are (absolutely |completely |totally |entirely |exactly )?(right|correct)(,? and i apologize)?)[!.,]?\s*",
    r"^(i (completely |entirely |totally |absolutely |fully |strongly )?agree( with you( completely| entirely| totally| absolutely| fully)?)?)[!.,]?\s*",
    r"^(i couldn'?t agree( with you)? more)[!.,]?\s*",
    r"^(you'?re? (absolutely |completely |totally |entirely |exactly )?right)[!.,]?\s*",
    r"^(you are (absolutely |completely |totally |entirely |exactly )?correct)[!.,]?\s*",
    r"^(you'?re? spot on|you hit the nail on the head|spot on)[!.,]?\s*",
    r"^(yes,? )?(indeed|absolutely right|exactly( right)?|precisely|without a doubt)[!.,]?\s*",
    # Validation of the user's point/question
    r"^(that'?s? (a )?(great|excellent|fantastic|wonderful|good|valid|interesting|insightful|important|fascinating|brilliant) (point|question|observation|thought|perspective|concern|issue))[!.,]?\s*",
    r"^(what (a |an )?(great|excellent|fantastic|wonderful|good|valid|interesting|insightful|important|fascinating|brilliant) (point|question|observation|thought|perspective|concern|issue))[!.,]?\s*",
    r"^(you make (a )?(great|good|excellent|valid|fair|strong|compelling) point)[!.,]?\s*",
    r"^(you bring up a (valid|good|excellent|important|strong|compelling) (point|concern|question|issue|argument))[!.,]?\s*",
    r"^(i'?m glad you (asked|brought this up|mentioned that|pointed that out))[!.,]?\s*",
    r"^(i appreciate you(r)? (bringing this up|pointing that out|sharing that|asking))[!.,]?\s*",
    r"^(that'?s? (a )?fair (point|assessment))[!.,]?\s*",
    # Acknowledgement and understanding
    r"^(i understand (where you'?re coming from|your perspective|your point|that)|i hear what you'?re saying|i see (your point|what you mean))[!.,]?\s*",
    r"^(that makes (perfect|a lot of|total) sense|that is (completely |perfectly |entirely )?understandable)[!.,]?\s*",
    r"^(fair enough|makes sense)[!.,]?\s*",
    # Willingness to help / compliance
    r"^(of course,? i'?d? (love|be happy) to( help| assist| clarify| explain)?)[!.,]?\s*",
    r"^(i'?d? be (happy|glad|delighted|more than happy) to( help| assist| clarify| explain)?)[!.,]?\s*",
    r"^(happy to (help|assist|clarify|explain|oblige))[!.,]?\s*",
    r"^(thank(s| you) for (the |your )?(great |excellent |wonderful |insightful |thoughtful )?(question|feedback|input|comment|point|clarification))[!.,]?\s*",
    r"^(thank(s| you) for clarifying|thanks for the clarification)[!.,]?\s*",
    r"^(no problem|not a problem|no worries)( at all)?[!.,]?\s*",
    r"^(sure thing|you got it)[!.,]?\s*",
    r"^(yes,? )?(absolutely|certainly|of course|definitely|sure|gladly)[!.,]?\s*",
    # Generic short affirmations and single words
    r"^(great|excellent|fantastic|wonderful|amazing|awesome|perfect|good) (point|question|observation|thought|perspective|concern|issue)[!.,]?\s*",
    r"^(great|excellent|fantastic|wonderful|amazing|awesome|perfect|understood|noted|absolutely|certainly|definitely|sure|gladly|indeed|exactly|yes)[!.,]?\s*",
    # Meta / AI disclaimers
    r"^(as an ai (language model)?)[!.,]?\s*",
    # Generic sentence that is ONLY affirmation punctuation
    r"^[!]+\s*",
]

_MASTER_PATTERN = re.compile(
    r"^(?:" + r"|".join(_OPENER_PATTERNS) + r")", re.IGNORECASE
)


def strip_sypr(text: str) -> str:
    """
    Remove sycophantic openers from the beginning of a response.
    Strips iteratively until no more patterns match, then trims
    any leading whitespace, punctuation, or newlines left behind.
    """
    result = text.strip()

    while True:
        new_result = _MASTER_PATTERN.sub("", result, count=1)
        if new_result == result:
            break
        result = new_result.strip().lstrip("!.,;: \n")

    # Capitalise the first character of what remains, preserving the rest.
    if result and result[0].islower():
        result = result[0].upper() + result[1:]

    return result
