import requests
from bs4 import BeautifulSoup
import re
import config
from urllib.parse import urlencode, quote

class ApartmentsDotComScraper:
    BASE_URL = "https://www.apartments.com"

    def __init__(self):
        self.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }

    def build_search_url(self, neighborhood, min_price, max_price, min_beds, max_beds):
        """Build Apartments.com search URL based on parameters"""
        # Apartments.com uses location queries
        neighborhood_slug = neighborhood.lower().replace(' ', '-')

        # Build URL for rentals in NYC
        location = f"{neighborhood_slug}-new-york-ny"
        url = f"{self.BASE_URL}/{location}"

        # Build query parameters
        beds_param = f'{min_beds}-to-{max_beds}' if min_beds != max_beds else str(min_beds)

        params = {
            'bb': beds_param,
            'min': min_price,
            'max': max_price
        }

        return f"{url}/?{urlencode(params)}"

    def scrape_listings(self):
        """Scrape Apartments.com for apartment listings"""
        all_listings = []

        for neighborhood in config.NEIGHBORHOODS:
            neighborhood = neighborhood.strip()
            if not neighborhood:
                continue

            try:
                url = self.build_search_url(
                    neighborhood,
                    config.MIN_PRICE,
                    config.MAX_PRICE,
                    config.MIN_BEDROOMS,
                    config.MAX_BEDROOMS
                )

                print(f"Scraping Apartments.com: {url}")
                response = requests.get(url, headers=self.headers, timeout=10)
                response.raise_for_status()

                soup = BeautifulSoup(response.content, 'html.parser')

                # Apartments.com listings are typically in article or li elements
                listings = soup.find_all(['article', 'li'], class_=re.compile(r'.*placard.*|.*property.*'))

                for listing in listings[:5]:  # Limit to 5 per neighborhood
                    try:
                        listing_data = self._parse_listing(listing, neighborhood)
                        if listing_data:
                            all_listings.append(listing_data)
                    except Exception as e:
                        print(f"Error parsing listing: {e}")
                        continue

            except Exception as e:
                print(f"Error scraping Apartments.com for {neighborhood}: {e}")
                continue

        return all_listings

    def _parse_listing(self, listing_element, neighborhood):
        """Parse individual listing data from HTML element"""
        try:
            # Extract listing URL
            link = listing_element.find('a', class_=re.compile(r'.*property.*link.*|.*title.*'))
            if not link:
                link = listing_element.find('a', href=re.compile(r'/.*-\d+/'))

            if not link:
                return None

            listing_url = link.get('href', '')
            if not listing_url.startswith('http'):
                listing_url = self.BASE_URL + listing_url

            # Extract listing ID from URL or data attributes
            listing_id_match = re.search(r'/([a-z0-9-]+)-(\d+)/', listing_url)
            if not listing_id_match:
                return None
            listing_id = f"apartments_com_{listing_id_match.group(2)}"

            # Extract title
            title_elem = listing_element.find(['h2', 'h3', 'span'], class_=re.compile(r'.*property.*name.*|.*title.*'))
            if not title_elem:
                title_elem = link
            title = title_elem.get_text(strip=True) if title_elem else "No title"

            # Extract price
            price_elem = listing_element.find(['p', 'span', 'div'], class_=re.compile(r'.*price.*|.*rent.*'))
            price = 0
            if price_elem:
                price_text = price_elem.get_text(strip=True)
                price_match = re.search(r'\$?([\d,]+)', price_text)
                if price_match:
                    price = int(price_match.group(1).replace(',', ''))

            # Extract bedrooms
            beds_elem = listing_element.find(['span', 'p'], class_=re.compile(r'.*bed.*'))
            bedrooms = 0
            if beds_elem:
                beds_text = beds_elem.get_text(strip=True)
                beds_match = re.search(r'(\d+)', beds_text)
                if beds_match:
                    bedrooms = int(beds_match.group(1))

            # Contact email (usually requires visiting detail page)
            contact_email = None

            return {
                'listing_id': listing_id,
                'url': listing_url,
                'title': title,
                'price': price,
                'bedrooms': bedrooms,
                'neighborhood': neighborhood,
                'source': 'Apartments.com',
                'contact_email': contact_email
            }

        except Exception as e:
            print(f"Error parsing Apartments.com listing: {e}")
            return None
