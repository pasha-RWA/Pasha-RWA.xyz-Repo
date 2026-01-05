import sqlite3
from datetime import datetime
import config

class ApartmentDatabase:
    def __init__(self, db_path=config.DATABASE_PATH):
        self.db_path = db_path
        self.init_database()

    def init_database(self):
        """Initialize the database with required tables"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()

        # Table for tracking seen listings
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS listings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                listing_id TEXT UNIQUE NOT NULL,
                url TEXT NOT NULL,
                title TEXT,
                price INTEGER,
                bedrooms INTEGER,
                neighborhood TEXT,
                source TEXT,
                contact_email TEXT,
                first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                discord_message_id TEXT,
                email_sent BOOLEAN DEFAULT 0,
                email_sent_at TIMESTAMP
            )
        ''')

        conn.commit()
        conn.close()

    def listing_exists(self, listing_id):
        """Check if a listing has already been seen"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute('SELECT id FROM listings WHERE listing_id = ?', (listing_id,))
        result = cursor.fetchone()
        conn.close()
        return result is not None

    def add_listing(self, listing_data):
        """Add a new listing to the database"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()

        try:
            cursor.execute('''
                INSERT INTO listings
                (listing_id, url, title, price, bedrooms, neighborhood, source, contact_email)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                listing_data['listing_id'],
                listing_data['url'],
                listing_data.get('title'),
                listing_data.get('price'),
                listing_data.get('bedrooms'),
                listing_data.get('neighborhood'),
                listing_data.get('source'),
                listing_data.get('contact_email')
            ))
            conn.commit()
            return True
        except sqlite3.IntegrityError:
            return False
        finally:
            conn.close()

    def update_discord_message_id(self, listing_id, message_id):
        """Update the Discord message ID for a listing"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute(
            'UPDATE listings SET discord_message_id = ? WHERE listing_id = ?',
            (str(message_id), listing_id)
        )
        conn.commit()
        conn.close()

    def mark_email_sent(self, listing_id):
        """Mark that an email has been sent for a listing"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute(
            'UPDATE listings SET email_sent = 1, email_sent_at = ? WHERE listing_id = ?',
            (datetime.now(), listing_id)
        )
        conn.commit()
        conn.close()

    def get_listing_by_message_id(self, message_id):
        """Get listing data by Discord message ID"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute(
            'SELECT * FROM listings WHERE discord_message_id = ?',
            (str(message_id),)
        )
        result = cursor.fetchone()
        conn.close()

        if result:
            return {
                'id': result[0],
                'listing_id': result[1],
                'url': result[2],
                'title': result[3],
                'price': result[4],
                'bedrooms': result[5],
                'neighborhood': result[6],
                'source': result[7],
                'contact_email': result[8],
                'first_seen': result[9],
                'discord_message_id': result[10],
                'email_sent': result[11],
                'email_sent_at': result[12]
            }
        return None
