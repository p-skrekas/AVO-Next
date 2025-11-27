import axios from 'axios';
import type { Product, ProductListResponse, CreateProductRequest, UpdateProductRequest } from './product-types';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export const productAPI = {
  listProducts: async (): Promise<ProductListResponse> => {
    const response = await api.get<ProductListResponse>('/api/products/');
    return response.data;
  },

  getProduct: async (productId: string): Promise<Product> => {
    const response = await api.get<Product>(`/api/products/${productId}`);
    return response.data;
  },

  createProduct: async (request: CreateProductRequest): Promise<Product> => {
    const response = await api.post<Product>('/api/products/', request);
    return response.data;
  },

  updateProduct: async (productId: string, request: UpdateProductRequest): Promise<Product> => {
    const response = await api.put<Product>(`/api/products/${productId}`, request);
    return response.data;
  },

  deleteProduct: async (productId: string): Promise<{ message: string }> => {
    const response = await api.delete<{ message: string }>(`/api/products/${productId}`);
    return response.data;
  },

  seedProducts: async (): Promise<{ message: string }> => {
    const response = await api.post<{ message: string }>('/api/products/seed');
    return response.data;
  },
};
