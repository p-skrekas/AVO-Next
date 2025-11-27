#!/usr/bin/env python
"""Script to generate products_data.py from CSV file"""
import csv

csv_path = r'c:\Users\skrekas\Downloads\pasxalis-query.csv'

# Read the CSV file
products_lines = []
with open(csv_path, 'r', encoding='utf-8') as f:
    reader = csv.reader(f)
    next(reader)  # Skip header
    for row in reader:
        if row and len(row) >= 5:
            product_id = row[0].strip()
            title = row[1].strip()
            units_relation = row[2].strip()
            main_unit = row[3].strip()
            secondary_unit = row[4].strip()
            products_lines.append(f'{product_id},{title},{units_relation},{main_unit},{secondary_unit}')

# Generate the Python file
output = '''# Product data extracted from pasxalis-query.csv
# Auto-generated - do not edit manually

PRODUCTS_CSV_DATA = """'''

output += '\n'.join(products_lines)
output += '''"""


def get_products_from_csv():
    """Parse CSV data and return list of product dictionaries"""
    products = []
    for line in PRODUCTS_CSV_DATA.strip().split('\\n'):
        parts = line.split(',')
        if len(parts) == 5:
            products.append({
                "product_id": parts[0],
                "title": parts[1],
                "units_relation": int(parts[2]),
                "main_unit_description": parts[3],
                "secondary_unit_description": parts[4]
            })
    return products
'''

# Write to file
with open('app/products_data.py', 'w', encoding='utf-8') as f:
    f.write(output)

print(f"Generated products_data.py with {len(products_lines)} products")
