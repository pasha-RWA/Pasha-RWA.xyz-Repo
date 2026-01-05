# 🏠 Apartment Listing Tracker Bot

An automated bot that tracks apartment listings from multiple websites (StreetEasy, Apartments.com, etc.), posts them to Discord, and sends inquiry emails to brokers based on your reactions.

## ✨ Features

- **Multi-Source Scraping**: Automatically scrapes StreetEasy, Apartments.com, and more
- **Smart Filtering**: Filter by NYC neighborhoods, bedrooms, and price range
- **Discord Integration**: New listings posted directly to your Discord channel
- **React to Inquire**: Simply react with ✅ to automatically send an inquiry email
- **Duplicate Detection**: Tracks seen listings in SQLite database
- **Customizable Schedule**: Configure how often to check for new listings
- **Professional Emails**: Sends well-formatted inquiry emails to brokers

## 📋 Prerequisites

- Python 3.8 or higher
- Discord account and server
- Gmail account (or other SMTP-compatible email)

## 🚀 Setup Instructions

### 1. Clone and Install Dependencies

```bash
cd apartment-tracker
pip install -r requirements.txt
```

### 2. Create Discord Bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click "New Application" and give it a name
3. Go to "Bot" tab and click "Add Bot"
4. Enable these Privileged Gateway Intents:
   - MESSAGE CONTENT INTENT
   - SERVER MEMBERS INTENT
5. Copy the bot token (you'll need this later)
6. Go to "OAuth2" > "URL Generator"
7. Select scopes: `bot`
8. Select bot permissions: `Send Messages`, `Read Message History`, `Add Reactions`, `Embed Links`
9. Copy the generated URL and open it to invite the bot to your server

### 3. Get Discord Channel ID

1. Enable Developer Mode in Discord (User Settings > Advanced > Developer Mode)
2. Right-click on the channel where you want listings posted
3. Click "Copy ID"

### 4. Set Up Email (Gmail)

1. Enable 2-Factor Authentication on your Gmail account
2. Generate an App Password:
   - Go to Google Account Settings
   - Security > 2-Step Verification > App passwords
   - Select "Mail" and "Other (Custom name)"
   - Copy the generated 16-character password

### 5. Configure Environment Variables

Copy the example environment file and fill in your details:

```bash
cp .env.example .env
```

Edit `.env` with your information:

```env
# Discord Configuration
DISCORD_BOT_TOKEN=your_bot_token_here
DISCORD_CHANNEL_ID=your_channel_id_here

# Email Configuration
EMAIL_ADDRESS=your_email@gmail.com
EMAIL_PASSWORD=your_16_char_app_password
SMTP_SERVER=smtp.gmail.com
SMTP_PORT=587

# Search Parameters
NEIGHBORHOODS=Upper West Side,Astoria,Williamsburg,Long Island City
MIN_BEDROOMS=1
MAX_BEDROOMS=2
MIN_PRICE=1500
MAX_PRICE=3500

# Scraping Configuration
SCRAPE_INTERVAL_MINUTES=60
```

### 6. Run the Bot

```bash
python main.py
```

Or make it executable:

```bash
chmod +x main.py
./main.py
```

## 📖 Usage

### Automatic Mode

Once running, the bot will:
1. Automatically scrape listings every hour (configurable)
2. Post new listings to your Discord channel
3. Add a ✅ reaction to each listing

### Interacting with Listings

- **Send Inquiry**: React with ✅ to a listing to automatically send an inquiry email
- **Manual Search**: Type `!search` to trigger an immediate search
- **View Stats**: Type `!stats` to see current configuration
- **Manual Email**: If broker email wasn't found automatically, use:
  ```
  !sendemail <broker_email>
  ```
  (Reply to the listing message when using this command)

## 🔧 Configuration

### Neighborhoods

Edit the `NEIGHBORHOODS` variable in `.env`:
```env
NEIGHBORHOODS=Upper West Side,Astoria,Williamsburg,Long Island City,Chelsea,East Village
```

Common NYC neighborhoods:
- Manhattan: Upper West Side, Upper East Side, Midtown, Chelsea, East Village, West Village, Harlem, Murray Hill
- Brooklyn: Williamsburg, Greenpoint, Park Slope, Brooklyn Heights, DUMBO, Bed-Stuy
- Queens: Astoria, Long Island City, Forest Hills, Sunnyside

### Price and Bedrooms

Adjust in `.env`:
```env
MIN_BEDROOMS=1
MAX_BEDROOMS=3
MIN_PRICE=2000
MAX_PRICE=4000
```

### Scraping Frequency

Change how often to check for new listings (in minutes):
```env
SCRAPE_INTERVAL_MINUTES=30  # Check every 30 minutes
```

## 🛠️ Advanced Features

### Adding More Scrapers

To add support for more websites:

1. Create a new scraper in `scrapers/` directory (e.g., `zillow.py`)
2. Follow the pattern from existing scrapers
3. Add it to `discord_bot.py`:

```python
from scrapers.zillow import ZillowScraper

scrapers = [
    StreetEasyScraper(),
    ApartmentsDotComScraper(),
    ZillowScraper()  # Add your new scraper
]
```

### Database Management

The bot uses SQLite to track listings. The database file is `apartment_tracker.db`.

To reset the database (start fresh):
```bash
rm apartment_tracker.db
```

### Email Customization

Edit the email template in `utils/email_sender.py` in the `_create_email_body()` method.

## 📊 Project Structure

```
apartment-tracker/
├── main.py                 # Entry point
├── discord_bot.py          # Discord bot logic
├── config.py              # Configuration loader
├── requirements.txt       # Python dependencies
├── .env.example          # Environment template
├── .env                  # Your configuration (create this)
├── apartment_tracker.db  # SQLite database (auto-created)
├── scrapers/
│   ├── streeteasy.py     # StreetEasy scraper
│   └── apartments_com.py # Apartments.com scraper
└── utils/
    ├── database.py       # Database operations
    └── email_sender.py   # Email functionality
```

## ⚠️ Important Notes

### Web Scraping Ethics

- The scrapers include rate limiting and respect for websites
- Some websites may block automated access
- Consider using official APIs when available
- This tool is for personal use only

### Email Limits

- Gmail has sending limits (~500 emails/day)
- Don't spam brokers with multiple emails
- The bot prevents duplicate emails for the same listing

### Privacy & Security

- Never commit your `.env` file to version control
- Keep your Discord bot token and email password secure
- The `.env.example` is provided as a template only

## 🐛 Troubleshooting

### Bot doesn't connect to Discord
- Check that your bot token is correct in `.env`
- Ensure the bot has been invited to your server
- Verify the channel ID is correct

### No listings found
- Websites may have changed their HTML structure
- Check if the website is accessible
- Verify your search parameters aren't too restrictive
- Look at console output for errors

### Emails not sending
- Verify Gmail app password is correct (16 characters, no spaces)
- Check that 2FA is enabled on your Gmail
- Ensure SMTP settings are correct
- Some listings may not have broker emails available

### "Module not found" errors
- Run `pip install -r requirements.txt`
- Ensure you're using Python 3.8+

## 📝 To-Do / Future Enhancements

- [ ] Add more apartment listing websites
- [ ] Web dashboard for managing listings
- [ ] Machine learning to predict good matches
- [ ] Price trend tracking
- [ ] Apartment comparison features
- [ ] SMS notifications option
- [ ] Support for other cities besides NYC

## 📄 License

This project is for personal use. Please respect the terms of service of the websites being scraped.

## 🤝 Contributing

Feel free to submit issues, fork the repository, and create pull requests for any improvements.

## ⚡ Quick Start Summary

```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Copy and edit configuration
cp .env.example .env
# Edit .env with your settings

# 3. Run the bot
python main.py
```

That's it! The bot will start monitoring listings and posting to Discord. React with ✅ to any listing to send an inquiry email.

---

Happy apartment hunting! 🏠✨
