#!/usr/bin/env python3
"""
Setup verification script for the Apartment Tracker Bot

Run this script to verify your configuration is correct before starting the bot.
"""

import sys
import os

def check_env_file():
    """Check if .env file exists"""
    print("1. Checking for .env file...")
    if os.path.exists('.env'):
        print("   ✅ .env file found")
        return True
    else:
        print("   ❌ .env file not found")
        print("   → Copy .env.example to .env and fill in your settings")
        return False

def check_dependencies():
    """Check if required packages are installed"""
    print("\n2. Checking dependencies...")
    required = ['discord', 'requests', 'bs4', 'dotenv']
    missing = []

    for package in required:
        try:
            __import__(package)
            print(f"   ✅ {package}")
        except ImportError:
            print(f"   ❌ {package}")
            missing.append(package)

    if missing:
        print(f"\n   → Install missing packages: pip install -r requirements.txt")
        return False
    return True

def check_config():
    """Check configuration values"""
    print("\n3. Checking configuration...")
    try:
        import config

        checks = [
            ("Discord Bot Token", config.DISCORD_BOT_TOKEN),
            ("Discord Channel ID", config.DISCORD_CHANNEL_ID),
            ("Email Address", config.EMAIL_ADDRESS),
            ("Email Password", config.EMAIL_PASSWORD),
            ("Neighborhoods", config.NEIGHBORHOODS and len(config.NEIGHBORHOODS) > 0)
        ]

        all_valid = True
        for name, value in checks:
            if value:
                print(f"   ✅ {name}")
            else:
                print(f"   ❌ {name} not set")
                all_valid = False

        if not all_valid:
            print("\n   → Update your .env file with the missing values")
        return all_valid

    except Exception as e:
        print(f"   ❌ Error loading config: {e}")
        return False

def main():
    """Run all checks"""
    print("=" * 50)
    print("Apartment Tracker Bot - Setup Verification")
    print("=" * 50)

    results = [
        check_env_file(),
        check_dependencies(),
        check_config()
    ]

    print("\n" + "=" * 50)
    if all(results):
        print("✅ All checks passed! You're ready to run the bot.")
        print("\nStart the bot with: python main.py")
    else:
        print("❌ Some checks failed. Please fix the issues above.")
        sys.exit(1)
    print("=" * 50)

if __name__ == '__main__':
    main()
