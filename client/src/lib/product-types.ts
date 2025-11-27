export interface Product {
  product_id: string;
  title: string;
  units_relation: number;
  main_unit_description: string;
  secondary_unit_description: string;
}

export interface CreateProductRequest {
  product_id: string;
  title: string;
  units_relation?: number;
  main_unit_description?: string;
  secondary_unit_description?: string;
}

export interface UpdateProductRequest {
  title?: string;
  units_relation?: number;
  main_unit_description?: string;
  secondary_unit_description?: string;
}

export interface ProductListResponse {
  products: Product[];
  total: number;
}
