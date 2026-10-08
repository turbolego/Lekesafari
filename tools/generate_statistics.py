import json
from datetime import datetime
import os

# Ensure we're in the right directory
os.chdir(os.path.dirname(os.path.abspath(__file__)) + '/..')

# Load the playgrounds data
try:
    with open('data/playgrounds_all.geojson', 'r') as f:
        data = json.load(f)
except FileNotFoundError:
    print("Warning: data/playgrounds_all.geojson not found. Skipping statistics generation.")
    exit(0)

# Initialize statistics
stats = {
    'total_playgrounds': len(data['features']),
    'highest_rating': {'name': '', 'rating': 0},
    'highest_data_quality': {'name': '', 'score': 0},
    'last_verified': {'name': '', 'date': '1970-01-01'},
    'most_verified': {'name': '', 'count': 0},
    'municipality_stats': {},
    'equipment_stats': {},
    'accessibility_stats': {
        'wheelchair': 0,
        'stroller': 0
    }
}

# Process each playground
for feature in data['features']:
    props = feature['properties']

    # Highest rating
    if props['rating']['average'] > stats['highest_rating']['rating']:
        stats['highest_rating'] = {
            'name': props['name'],
            'rating': props['rating']['average']
        }

    # Data quality score (number of filled fields)
    quality_score = sum(1 for key in props if props[key])
    if quality_score > stats['highest_data_quality']['score']:
        stats['highest_data_quality'] = {
            'name': props['name'],
            'score': quality_score
        }

    # Last verified
    if props['lastVerified'] > stats['last_verified']['date']:
        stats['last_verified'] = {
            'name': props['name'],
            'date': props['lastVerified']
        }

    # Most verified (assuming verified is a boolean)
    if props.get('verified', False):
        if props['name'] in stats['most_verified']:
            stats['most_verified'][props['name']] += 1
        else:
            stats['most_verified'][props['name']] = 1

    # Municipality statistics
    municipality = props['municipality']
    if municipality in stats['municipality_stats']:
        stats['municipality_stats'][municipality] += 1
    else:
        stats['municipality_stats'][municipality] = 1

    # Equipment statistics
    for equipment in props['equipment']:
        if equipment['type'] in stats['equipment_stats']:
            stats['equipment_stats'][equipment['type']] += 1
        else:
            stats['equipment_stats'][equipment['type']] = 1

    # Accessibility statistics
    if props['accessibility']['wheelchair'] == 'yes':
        stats['accessibility_stats']['wheelchair'] += 1
    if props['accessibility']['stroller'] == 'yes':
        stats['accessibility_stats']['stroller'] += 1

# Find most verified playground
if stats['most_verified']:
    most_verified_name = max(stats['most_verified'], key=stats['most_verified'].get)
    stats['most_verified'] = {
        'name': most_verified_name,
        'count': stats['most_verified'][most_verified_name]
    }

# Save statistics
with open('data/playground_stats.json', 'w') as f:
    json.dump(stats, f, indent=2)

print("Statistics generated successfully.")