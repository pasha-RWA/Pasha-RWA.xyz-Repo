import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import config

class EmailSender:
    def __init__(self):
        self.email = config.EMAIL_ADDRESS
        self.password = config.EMAIL_PASSWORD
        self.smtp_server = config.SMTP_SERVER
        self.smtp_port = config.SMTP_PORT

    def send_inquiry_email(self, listing_data, recipient_email=None):
        """
        Send an inquiry email to the broker/landlord

        Args:
            listing_data: Dictionary containing listing information
            recipient_email: Email address to send to (if None, tries to use contact from listing)
        """
        if not recipient_email and not listing_data.get('contact_email'):
            print("No recipient email provided")
            return False

        recipient = recipient_email or listing_data.get('contact_email')

        try:
            # Create message
            msg = MIMEMultipart('alternative')
            msg['From'] = self.email
            msg['To'] = recipient
            msg['Subject'] = f"Inquiry about {listing_data.get('title', 'Apartment Listing')}"

            # Create email body
            body = self._create_email_body(listing_data)

            # Attach body
            msg.attach(MIMEText(body, 'plain'))

            # Send email
            with smtplib.SMTP(self.smtp_server, self.smtp_port) as server:
                server.starttls()
                server.login(self.email, self.password)
                server.send_message(msg)

            print(f"Email sent successfully to {recipient}")
            return True

        except Exception as e:
            print(f"Error sending email: {e}")
            return False

    def _create_email_body(self, listing_data):
        """Create a professional inquiry email body"""
        body = f"""Hello,

I am interested in scheduling a tour for the following property:

Property: {listing_data.get('title', 'N/A')}
Address: {listing_data.get('neighborhood', 'N/A')}
Bedrooms: {listing_data.get('bedrooms', 'N/A')}
Price: ${listing_data.get('price', 'N/A'):,}/month
Listing URL: {listing_data.get('url', 'N/A')}

I would appreciate the opportunity to view this property at your earliest convenience. Please let me know your available times for a showing.

Could you also provide the following information:
- Is the apartment still available?
- What is the move-in date?
- What are the lease terms?
- Are utilities included?
- What is required for the application process?

Thank you for your time, and I look forward to hearing from you soon.

Best regards
"""
        return body

    def send_manual_inquiry(self, listing_url, title, neighborhood, bedrooms, price, broker_email):
        """
        Send an inquiry when broker email is manually provided
        Useful when the scraper couldn't extract the email automatically
        """
        listing_data = {
            'url': listing_url,
            'title': title,
            'neighborhood': neighborhood,
            'bedrooms': bedrooms,
            'price': price
        }

        return self.send_inquiry_email(listing_data, broker_email)
