import os
import sys

import requests
import geojson
from datetime import datetime

# Overpass API endpoint
OVERPASS_URL = "https://overpass-api.de/api/interpreter"

# Bounding box for Norway
NORWAY_BBOX = "10.0,58.0,31.0,71.5"

# Query to fetch playgrounds in Norway
QUERY = f"""
[out:json][timeout:25];
(
  node["leisure"="playground"]({NORWAY_BBOX});
  way["leisure"="playground"]({NORWAY_BBOX});
  relation["leisure"="playground"]({NORWAY_BBOX});
);
out center;
"""

def fetch_playgrounds():
    try:
        # Send request to Overpass API
        response = requests.post(OVERPASS_URL, data={'data': QUERY})
        response.raise_for_status()

        # Parse the response
        data = response.json()

        # Convert to GeoJSON format
        features = []
        for element in data['elements']:
            if 'lat' in element and 'lon' in element:
                properties = {
                    'id': element.get('id', ''),
                    'name': element.get('tags', {}).get('name', 'Ukjent lekeplass'),
                    'source': 'osm',
                    'verified': False,
                    'lastVerified': datetime.now().strftime('%Y-%m-%d'),
                    'images': [],
                    'age': {
                        'min': element.get('tags', {}).get('min_age', 0),
                        'max': element.get('tags', {}).get('max_age', 18)
                    },
                    'opening': element.get('tags', {}).get('opening_hours', 'Ukjent'),
                    'equipment': [],
                    'rating': {
                        'average': 0,
                        'count': 0
                    },
                    'accessibility': {
                        'wheelchair': element.get('tags', {}).get('wheelchair', 'no'),
                        'stroller': element.get('tags', {}).get('stroller', 'no')
                    },
                    'fenced': element.get('tags', {}).get('fenced', 'no') == 'yes',
                    'toilets': element.get('tags', {}).get('toilets', 'no') == 'yes',
                    'parking': {
                        'free': element.get('tags', {}).get('parking', 'no') == 'yes',
                        'paid': element.get('tags', {}).get('parking_fee', 'no') == 'yes'
                    },
                    'dogs': {
                        'allowed': element.get('tags', {}).get('dogs', 'no') == 'yes',
                        'leash': element.get('tags', {}).get('leashed', 'no') == 'yes'
                    },
                    'municipality': element.get('tags', {}).get('addr:city', 'Ukjent')
                }

                # Add equipment
                for tag, name in element.get('tags', {}).items():
                    if tag.startswith('playground:') and name == 'yes':
                        equipment_type = tag.split(':')[1]
                        properties['equipment'].append({
                            'type': equipment_type,
                            'name': equipment_type.capitalize(),
                            'count': 1
                        })

                # Create GeoJSON feature
                feature = geojson.Feature(
                    geometry=geojson.Point((element['lon'], element['lat'])),
                    properties=properties
                )
                features.append(feature)

        # Create GeoJSON FeatureCollection
        feature_collection = geojson.FeatureCollection(features)

        # Save to file
        os.makedirs('data', exist_ok=True)
        with open('data/playgrounds_all.geojson', 'w') as f:
            geojson.dump(feature_collection, f, indent=2)

        print(f"Successfully fetched {len(features)} playgrounds in Norway.")

    except Exception as e:
        print(f"Error fetching playgrounds: {str(e)}")
        # Fail loudly so the workflow surfaces the real error instead of
        # silently running the statistics generator on a missing file.
        sys.exit(1)

if __name__ == "__main__":
    fetch_playgrounds()