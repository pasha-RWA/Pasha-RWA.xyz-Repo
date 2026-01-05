import requests
from bs4 import BeautifulSoup
import re
import config
from urllib.parse import urlencode

class StreetEasyScraper:
    BASE_URL = "https://streeteasy.com"

    def __init__(self):
        self.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }

    def build_search_url(self, neighborhood, min_price, max_price, min_beds, max_beds):
        """Build StreetEasy search URL based on parameters"""
        # StreetEasy uses area names in URLs
        neighborhood_slug = neighborhood.lower().replace(' ', '-')

        # Build URL for rentals
        url = f"{self.BASE_URL}/for-rent/{neighborhood_slug}"

        params = {
            'beds[]': f'{min_beds}' if min_beds == max_beds else f'{min_beds},{max_beds}',
            'price_min': min_price,
            'price_max': max_price
        }

        return f"{url}?{urlencode(params, doseq=True)}"

    def scrape_listings(self):
        """Scrape StreetEasy for apartment listings"""
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

                print(f"Scraping StreetEasy: {url}")
                response = requests.get(url, headers=self.headers, timeout=10)
                response.raise_for_status()

                soup = BeautifulSoup(response.content, 'html.parser')

                # StreetEasy listings are in article elements with specific classes
                listings = soup.find_all('article', class_=re.compile(r'listing.*'))

                for listing in listings[:5]:  # Limit to 5 per neighborhood to avoid overwhelming
                    try:
                        listing_data = self._parse_listing(listing, neighborhood)
                        if listing_data:
                            all_listings.append(listing_data)
                    except Exception as e:
                        print(f"Error parsing listing: {e}")
                        continue

            except Exception as e:
                print(f"Error scraping StreetEasy for {neighborhood}: {e}")
                continue

        return all_listings

    def _parse_listing(self, listing_element, neighborhood):
        """Parse individual listing data from HTML element"""
        try:
            # Extract listing ID from data attributes or URL
            link = listing_element.find('a', class_=re.compile(r'.*listing.*'))
            if not link:
                return None

            listing_url = link.get('href', '')
            if not listing_url.startswith('http'):
                listing_url = self.BASE_URL + listing_url

            # Extract listing ID from URL
            listing_id_match = re.search(r'/(\d+)-', listing_url)
            if not listing_id_match:
                return None
            listing_id = f"streeteasy_{listing_id_match.group(1)}"

            # Extract title
            title_elem = listing_element.find(['h3', 'h4'], class_=re.compile(r'.*listing.*title.*'))
            title = title_elem.get_text(strip=True) if title_elem else "No title"

            # Extract price
            price_elem = listing_element.find(['span', 'div'], class_=re.compile(r'.*price.*'))
            price = 0
            if price_elem:
                price_text = price_elem.get_text(strip=True)
                price_match = re.search(r'\$?([\d,]+)', price_text)
                if price_match:
                    price = int(price_match.group(1).replace(',', ''))

            # Extract bedrooms
            beds_elem = listing_element.find(text=re.compile(r'\d+\s*bed'))
            bedrooms = 0
            if beds_elem:
                beds_match = re.search(r'(\d+)', str(beds_elem))
                if beds_match:
                    bedrooms = int(beds_match.group(1))

            # Try to find contact info (may not be on listing page)
            contact_email = None

            return {
                'listing_id': listing_id,
                'url': listing_url,
                'title': title,
                'price': price,
                'bedrooms': bedrooms,
                'neighborhood': neighborhood,
                'source': 'StreetEasy',
                'contact_email': contact_email
            }

        except Exception as e:
            print(f"Error parsing StreetEasy listing: {e}")
            return None
