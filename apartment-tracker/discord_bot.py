import discord
from discord.ext import commands, tasks
import asyncio
import config
from utils.database import ApartmentDatabase
from utils.email_sender import EmailSender
from scrapers.streeteasy import StreetEasyScraper
from scrapers.apartments_com import ApartmentsDotComScraper

# Set up intents
intents = discord.Intents.default()
intents.message_content = True
intents.reactions = True

# Create bot
bot = commands.Bot(command_prefix='!', intents=intents)

# Initialize components
db = ApartmentDatabase()
email_sender = EmailSender()

# Reaction emoji to trigger email
TRIGGER_EMOJI = '✅'  # Check mark emoji


@bot.event
async def on_ready():
    print(f'{bot.user} has connected to Discord!')
    print(f'Bot is in {len(bot.guilds)} guilds')

    # Start the scraping task
    if not scrape_apartments.is_running():
        scrape_apartments.start()


@bot.event
async def on_reaction_add(reaction, user):
    """Handle reactions to apartment listings"""
    # Ignore bot's own reactions
    if user.bot:
        return

    # Check if reaction is the trigger emoji
    if str(reaction.emoji) != TRIGGER_EMOJI:
        return

    # Get listing from database
    listing = db.get_listing_by_message_id(reaction.message.id)

    if not listing:
        return

    # Check if email already sent
    if listing['email_sent']:
        await reaction.message.channel.send(
            f"✉️ Email already sent for this listing on {listing['email_sent_at']}"
        )
        return

    # Send inquiry message
    await reaction.message.channel.send(
        f"📧 Processing your inquiry for: {listing['title']}"
    )

    # Check if we have contact email or need to provide instructions
    if listing['contact_email']:
        # Send automated email
        success = email_sender.send_inquiry_email(listing)

        if success:
            db.mark_email_sent(listing['listing_id'])
            await reaction.message.channel.send(
                f"✅ Inquiry email sent successfully to broker!"
            )
        else:
            await reaction.message.channel.send(
                f"❌ Failed to send email. Please visit the listing directly: {listing['url']}"
            )
    else:
        # Provide instructions for manual contact
        await reaction.message.channel.send(
            f"⚠️ No broker email found automatically.\n"
            f"Please visit the listing to contact the broker: {listing['url']}\n\n"
            f"If you have the broker's email, use: `!sendemail <listing_id> <broker_email>`"
        )


@tasks.loop(minutes=config.SCRAPE_INTERVAL_MINUTES)
async def scrape_apartments():
    """Periodically scrape apartment websites for new listings"""
    print("Starting apartment scraping...")

    channel = bot.get_channel(config.DISCORD_CHANNEL_ID)
    if not channel:
        print(f"Could not find channel with ID {config.DISCORD_CHANNEL_ID}")
        return

    # Scrape from all sources
    scrapers = [
        StreetEasyScraper(),
        ApartmentsDotComScraper()
    ]

    new_listings_count = 0

    for scraper in scrapers:
        try:
            listings = scraper.scrape_listings()
            print(f"Found {len(listings)} listings from {scraper.__class__.__name__}")

            for listing in listings:
                # Check if listing is new
                if not db.listing_exists(listing['listing_id']):
                    # Add to database
                    db.add_listing(listing)

                    # Post to Discord
                    embed = create_listing_embed(listing)
                    message = await channel.send(embed=embed)

                    # Add reaction emoji for easy interaction
                    await message.add_reaction(TRIGGER_EMOJI)

                    # Store message ID
                    db.update_discord_message_id(listing['listing_id'], message.id)

                    new_listings_count += 1
                    await asyncio.sleep(1)  # Rate limiting

        except Exception as e:
            print(f"Error during scraping: {e}")

    if new_listings_count > 0:
        await channel.send(f"🏠 Found {new_listings_count} new listings!")
    else:
        print("No new listings found")


def create_listing_embed(listing):
    """Create a Discord embed for an apartment listing"""
    embed = discord.Embed(
        title=listing['title'],
        url=listing['url'],
        description=f"New listing in {listing['neighborhood']}",
        color=discord.Color.blue()
    )

    # Add fields
    if listing.get('price'):
        embed.add_field(name="💰 Price", value=f"${listing['price']:,}/month", inline=True)

    if listing.get('bedrooms'):
        embed.add_field(name="🛏️ Bedrooms", value=str(listing['bedrooms']), inline=True)

    embed.add_field(name="📍 Neighborhood", value=listing['neighborhood'], inline=True)
    embed.add_field(name="🌐 Source", value=listing['source'], inline=True)

    embed.set_footer(text=f"React with {TRIGGER_EMOJI} to send inquiry email")

    return embed


@bot.command(name='sendemail')
async def send_email_command(ctx, listing_id: str, broker_email: str):
    """Manually send an email for a listing"""
    listing = db.get_listing_by_message_id(ctx.message.reference.message_id if ctx.message.reference else None)

    if not listing:
        await ctx.send("Could not find listing. Please reply to a listing message.")
        return

    await ctx.send(f"📧 Sending inquiry email to {broker_email}...")

    success = email_sender.send_inquiry_email(listing, broker_email)

    if success:
        db.mark_email_sent(listing['listing_id'])
        await ctx.send("✅ Email sent successfully!")
    else:
        await ctx.send("❌ Failed to send email. Please check the logs.")


@bot.command(name='search')
async def manual_search(ctx):
    """Manually trigger a search"""
    await ctx.send("🔍 Starting manual search...")
    await scrape_apartments()


@bot.command(name='stats')
async def show_stats(ctx):
    """Show bot statistics"""
    # This is a simple implementation - you could expand this
    await ctx.send(
        f"📊 **Bot Statistics**\n"
        f"Scrape interval: {config.SCRAPE_INTERVAL_MINUTES} minutes\n"
        f"Neighborhoods: {', '.join(config.NEIGHBORHOODS)}\n"
        f"Bedrooms: {config.MIN_BEDROOMS}-{config.MAX_BEDROOMS}\n"
        f"Price range: ${config.MIN_PRICE:,}-${config.MAX_PRICE:,}"
    )


def run_bot():
    """Run the Discord bot"""
    if not config.DISCORD_BOT_TOKEN:
        print("Error: DISCORD_BOT_TOKEN not set in .env file")
        return

    bot.run(config.DISCORD_BOT_TOKEN)


if __name__ == '__main__':
    run_bot()
