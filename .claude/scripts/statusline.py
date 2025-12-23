#!/usr/bin/env python3
"""
Custom Claude Code Statusline
Shows token usage and conversation log file path using built-in Claude Code data
"""

import json
import sys


def format_tokens(tokens: int) -> str:
    """Format token count with thousands separator."""
    return f"{tokens:,}"


def get_percentage(current: int, limit: int) -> int:
    """Calculate percentage of limit used."""
    if limit == 0:
        return 0
    return int((current / limit) * 100)


def main():
    """Main statusline script."""
    try:
        input_data = json.load(sys.stdin)
    except json.JSONDecodeError:
        print("⚠️  No input data")
        return

    context_window = input_data.get("context_window", {})
    current_usage = context_window.get("current_usage")

    if current_usage is None:
        print("⚠️  Waiting for first message...")
        return

    input_tokens = current_usage.get("input_tokens", 0)
    cache_creation = current_usage.get("cache_creation_input_tokens", 0)
    cache_read = current_usage.get("cache_read_input_tokens", 0)

    total_context = input_tokens + cache_creation + cache_read

    if total_context == 0:
        print("⚠️  No usage data yet")
        return

    output_tokens = current_usage.get("output_tokens", 0)

    token_limit = context_window.get("context_window_size", 200000)
    percentage = get_percentage(total_context, token_limit)

    formatted_total = format_tokens(total_context)
    formatted_limit = format_tokens(token_limit)

    if percentage >= 95:
        status = "🔴"
    elif percentage >= 80:
        status = "🟡"
    else:
        status = "🟢"

    total_input = context_window.get("total_input_tokens", 0)
    total_output = context_window.get("total_output_tokens", 0)

    transcript_path = input_data.get("transcript_path", "")

    statusline_parts = [
        f"{status} Context: {formatted_total}/{formatted_limit} ({percentage}%)",
        f"📥 Input: {format_tokens(input_tokens)}",
        f"📤 Output: {format_tokens(output_tokens)}",
        f"🔨 Cache Write: {format_tokens(cache_creation)}",
        f"💾 Cache Read: {format_tokens(cache_read)}",
        f"📊 Session: {format_tokens(total_input)}↓ {format_tokens(total_output)}↑",
        f"📝 {transcript_path}"
    ]

    print(" | ".join(statusline_parts))


if __name__ == "__main__":
    main()
