#!/usr/bin/env python3
"""
Apartment Listing Tracker Bot

Main entry point for the apartment tracking bot that:
1. Scrapes apartment listings from multiple websites
2. Posts new listings to Discord
3. Monitors user reactions
4. Sends automated inquiry emails to brokers
"""

import sys
from discord_bot import run_bot

def main():
    """Main entry point"""
    print("=" * 50)
    print("Apartment Listing Tracker Bot")
    print("=" * 50)
    print()

    try:
        run_bot()
    except KeyboardInterrupt:
        print("\n\nBot stopped by user")
        sys.exit(0)
    except Exception as e:
        print(f"\n\nError running bot: {e}")
        sys.exit(1)


if __name__ == '__main__':
    main()
