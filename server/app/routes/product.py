from fastapi import APIRouter, HTTPException
from app.models.product import Product, ProductListResponse, CreateProductRequest, UpdateProductRequest
from app.core.database import mongodb
from app.core.products_data import get_products_from_csv
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/products", tags=["products"])


@router.post("/seed")
async def seed_products():
    """Seed products database from CSV data"""
    try:
        if not mongodb.is_connected():
            raise HTTPException(status_code=500, detail="MongoDB not connected")

        collection = mongodb.get_collection("products")
        collection.drop_indexes()
        collection.delete_many({})

        products_data = get_products_from_csv()
        products = [Product(**p) for p in products_data]

        collection.insert_many([p.model_dump(mode='json') for p in products])
        collection.create_index("product_id", unique=True)

        logger.info(f"Seeded {len(products)} products into database")
        return {"message": f"Successfully seeded {len(products)} products"}

    except Exception as e:
        logger.error(f"Error seeding products: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/", response_model=ProductListResponse)
async def list_products():
    """List all available products"""
    try:
        if not mongodb.is_connected():
            raise HTTPException(status_code=500, detail="MongoDB not connected")

        collection = mongodb.get_collection("products")
        products = []

        for doc in collection.find():
            doc.pop('_id', None)
            if 'id' in doc and 'product_id' not in doc:
                doc['product_id'] = str(doc.pop('id'))
            products.append(Product(**doc))

        return ProductListResponse(products=products, total=len(products))

    except Exception as e:
        logger.error(f"Error listing products: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{product_id}", response_model=Product)
async def get_product(product_id: str):
    """Get a specific product by ID"""
    try:
        if not mongodb.is_connected():
            raise HTTPException(status_code=500, detail="MongoDB not connected")

        collection = mongodb.get_collection("products")
        doc = collection.find_one({"product_id": product_id})
        if not doc:
            doc = collection.find_one({"id": product_id})

        if not doc:
            raise HTTPException(status_code=404, detail="Product not found")

        doc.pop('_id', None)
        if 'id' in doc and 'product_id' not in doc:
            doc['product_id'] = str(doc.pop('id'))
        return Product(**doc)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting product: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/", response_model=Product)
async def create_product(request: CreateProductRequest):
    """Create a new product"""
    try:
        if not mongodb.is_connected():
            raise HTTPException(status_code=500, detail="MongoDB not connected")

        collection = mongodb.get_collection("products")

        # Check if product_id already exists
        existing = collection.find_one({"product_id": request.product_id})
        if existing:
            raise HTTPException(status_code=400, detail=f"Product with ID '{request.product_id}' already exists")

        product = Product(
            product_id=request.product_id,
            title=request.title,
            units_relation=request.units_relation,
            main_unit_description=request.main_unit_description,
            secondary_unit_description=request.secondary_unit_description
        )

        collection.insert_one(product.model_dump(mode='json'))
        logger.info(f"Created product: {product.product_id}")

        return product

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating product: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{product_id}", response_model=Product)
async def update_product(product_id: str, request: UpdateProductRequest):
    """Update an existing product"""
    try:
        if not mongodb.is_connected():
            raise HTTPException(status_code=500, detail="MongoDB not connected")

        collection = mongodb.get_collection("products")

        # Find existing product
        doc = collection.find_one({"product_id": product_id})
        if not doc:
            raise HTTPException(status_code=404, detail="Product not found")

        # Build update dict with only provided fields
        update_data = {}
        if request.title is not None:
            update_data["title"] = request.title
        if request.units_relation is not None:
            update_data["units_relation"] = request.units_relation
        if request.main_unit_description is not None:
            update_data["main_unit_description"] = request.main_unit_description
        if request.secondary_unit_description is not None:
            update_data["secondary_unit_description"] = request.secondary_unit_description

        if update_data:
            collection.update_one({"product_id": product_id}, {"$set": update_data})
            logger.info(f"Updated product: {product_id}")

        # Return updated product
        doc = collection.find_one({"product_id": product_id})
        doc.pop('_id', None)
        return Product(**doc)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating product: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{product_id}")
async def delete_product(product_id: str):
    """Delete a product"""
    try:
        if not mongodb.is_connected():
            raise HTTPException(status_code=500, detail="MongoDB not connected")

        collection = mongodb.get_collection("products")

        result = collection.delete_one({"product_id": product_id})

        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Product not found")

        logger.info(f"Deleted product: {product_id}")
        return {"message": f"Product '{product_id}' deleted successfully"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting product: {e}")
        raise HTTPException(status_code=500, detail=str(e))
