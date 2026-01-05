import os
from dotenv import load_dotenv

load_dotenv()

# Discord Configuration
DISCORD_BOT_TOKEN = os.getenv('DISCORD_BOT_TOKEN')
DISCORD_CHANNEL_ID = int(os.getenv('DISCORD_CHANNEL_ID', 0))

# Email Configuration
EMAIL_ADDRESS = os.getenv('EMAIL_ADDRESS')
EMAIL_PASSWORD = os.getenv('EMAIL_PASSWORD')
SMTP_SERVER = os.getenv('SMTP_SERVER', 'smtp.gmail.com')
SMTP_PORT = int(os.getenv('SMTP_PORT', 587))

# Search Parameters
NEIGHBORHOODS = os.getenv('NEIGHBORHOODS', '').split(',')
MIN_BEDROOMS = int(os.getenv('MIN_BEDROOMS', 1))
MAX_BEDROOMS = int(os.getenv('MAX_BEDROOMS', 2))
MIN_PRICE = int(os.getenv('MIN_PRICE', 1500))
MAX_PRICE = int(os.getenv('MAX_PRICE', 3500))

# Scraping Configuration
SCRAPE_INTERVAL_MINUTES = int(os.getenv('SCRAPE_INTERVAL_MINUTES', 60))

# Database
DATABASE_PATH = 'apartment_tracker.db'
