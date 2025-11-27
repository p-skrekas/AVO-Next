from pydantic import BaseModel, Field
from typing import List, Optional


class Product(BaseModel):
    product_id: str = Field(..., description="Product ID from CSV")
    title: str = Field(..., description="Product title/name")
    units_relation: int = Field(..., description="Number of main units per secondary unit")
    main_unit_description: str = Field(..., description="Main unit description (e.g., ΤΕΜΑΧΙΟ)")
    secondary_unit_description: str = Field(..., description="Secondary unit description (e.g., KOYTA)")


class CreateProductRequest(BaseModel):
    product_id: str = Field(..., description="Unique product ID")
    title: str = Field(..., description="Product title/name")
    units_relation: int = Field(default=10, description="Number of main units per secondary unit")
    main_unit_description: str = Field(default="ΤΕΜΑΧΙΟ", description="Main unit description")
    secondary_unit_description: str = Field(default="KOYTA", description="Secondary unit description")


class UpdateProductRequest(BaseModel):
    title: Optional[str] = None
    units_relation: Optional[int] = None
    main_unit_description: Optional[str] = None
    secondary_unit_description: Optional[str] = None


class ProductListResponse(BaseModel):
    products: List[Product]
    total: int
