import { useState, useEffect } from 'react';
import { productAPI } from '@/lib/product-api';
import type { Product, CreateProductRequest, UpdateProductRequest } from '@/lib/product-types';
import { RefreshCw, Package, Search, Database, Hash, Box, Layers, Plus, Pencil, Trash2, Save, X } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import DeleteConfirmationDialog from './DeleteConfirmationDialog';

export default function Products() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [seeding, setSeeding] = useState(false);

  // Add/Edit dialog state
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [formData, setFormData] = useState<CreateProductRequest>({
    product_id: '',
    title: '',
    units_relation: 10,
    main_unit_description: 'ΤΕΜΑΧΙΟ',
    secondary_unit_description: 'KOYTA'
  });
  const [saving, setSaving] = useState(false);

  // Delete dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [productToDelete, setProductToDelete] = useState<Product | null>(null);

  useEffect(() => {
    loadProducts();
  }, []);

  const loadProducts = async () => {
    setLoading(true);
    try {
      const response = await productAPI.listProducts();
      setProducts(response.products);
    } catch (err: any) {
      console.error('Error loading products:', err);
      toast.error(err.response?.data?.detail || 'Failed to load products');
    } finally {
      setLoading(false);
    }
  };

  const handleSeedProducts = async () => {
    if (!confirm('This will reset all products in the database. Continue?')) return;

    setSeeding(true);
    try {
      await productAPI.seedProducts();
      await loadProducts();
      toast.success('Products seeded successfully!');
    } catch (err: any) {
      console.error('Error seeding products:', err);
      toast.error(err.response?.data?.detail || 'Failed to seed products');
    } finally {
      setSeeding(false);
    }
  };

  const resetForm = () => {
    setFormData({
      product_id: '',
      title: '',
      units_relation: 10,
      main_unit_description: 'ΤΕΜΑΧΙΟ',
      secondary_unit_description: 'KOYTA'
    });
  };

  const openAddDialog = () => {
    resetForm();
    setEditingProduct(null);
    setShowAddDialog(true);
  };

  const openEditDialog = (product: Product) => {
    setFormData({
      product_id: product.product_id,
      title: product.title,
      units_relation: product.units_relation,
      main_unit_description: product.main_unit_description,
      secondary_unit_description: product.secondary_unit_description
    });
    setEditingProduct(product);
    setShowAddDialog(true);
  };

  const closeDialog = () => {
    setShowAddDialog(false);
    setEditingProduct(null);
    resetForm();
  };

  const handleSaveProduct = async () => {
    if (!formData.product_id.trim() || !formData.title.trim()) {
      toast.error('Product ID and Title are required');
      return;
    }

    setSaving(true);
    try {
      if (editingProduct) {
        // Update existing product
        const updateData: UpdateProductRequest = {
          title: formData.title,
          units_relation: formData.units_relation,
          main_unit_description: formData.main_unit_description,
          secondary_unit_description: formData.secondary_unit_description
        };
        await productAPI.updateProduct(editingProduct.product_id, updateData);
        toast.success('Product updated successfully');
      } else {
        // Create new product
        await productAPI.createProduct(formData);
        toast.success('Product created successfully');
      }
      await loadProducts();
      closeDialog();
    } catch (err: any) {
      console.error('Error saving product:', err);
      toast.error(err.response?.data?.detail || 'Failed to save product');
    } finally {
      setSaving(false);
    }
  };

  const openDeleteDialog = (product: Product) => {
    setProductToDelete(product);
    setDeleteDialogOpen(true);
  };

  const handleDeleteProduct = async () => {
    if (!productToDelete) return;

    try {
      await productAPI.deleteProduct(productToDelete.product_id);
      toast.success('Product deleted successfully');
      await loadProducts();
    } catch (err: any) {
      console.error('Error deleting product:', err);
      toast.error(err.response?.data?.detail || 'Failed to delete product');
    } finally {
      setDeleteDialogOpen(false);
      setProductToDelete(null);
    }
  };

  const filteredProducts = products.filter(product =>
    product.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    product.product_id.includes(searchTerm)
  );

  return (
    <div className="flex flex-col h-screen bg-[#0a0a0b]">
      {/* Header */}
      <div className="bg-[#121214] border-b border-[#2a2a2e] px-6 py-4">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-semibold text-[#fafafa]">Product Catalog</h1>
            <p className="text-sm text-[#71717a]">View and manage products in the database</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={loadProducts}
              disabled={loading}
              className="px-4 py-2 bg-[#1a1a1d] hover:bg-[#27272a] text-[#a1a1aa] hover:text-[#fafafa] font-medium rounded-lg border border-[#2a2a2e] transition-all duration-200 flex items-center gap-2"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              onClick={handleSeedProducts}
              disabled={seeding}
              className="px-4 py-2 bg-[#1a1a1d] hover:bg-[#27272a] text-[#a1a1aa] hover:text-[#fafafa] font-medium rounded-lg border border-[#2a2a2e] transition-all duration-200 flex items-center gap-2"
            >
              <Database className={`w-4 h-4 ${seeding ? 'animate-spin' : ''}`} />
              {seeding ? 'Seeding...' : 'Seed Database'}
            </button>
            <button
              onClick={openAddDialog}
              className="px-4 py-2 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 hover:from-indigo-400 hover:via-purple-400 hover:to-pink-400 text-white font-medium rounded-lg shadow-lg shadow-indigo-500/25 hover:shadow-indigo-500/40 transition-all duration-200 flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Add Product
            </button>
          </div>
        </div>
      </div>

      {/* Search Bar */}
      <div className="px-6 py-4 bg-[#121214] border-b border-[#2a2a2e]">
        <div className="flex items-center gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-[#52525b]" />
            <input
              type="text"
              placeholder="Search by name or ID..."
              className="w-full pl-10 pr-4 py-2.5 bg-[#0a0a0b] border border-[#2a2a2e] rounded-xl text-[#fafafa] placeholder:text-[#52525b] focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-[#52525b]">Showing</span>
            <span className="text-[#fafafa] font-medium">{filteredProducts.length}</span>
            <span className="text-[#52525b]">of</span>
            <span className="text-[#fafafa] font-medium">{products.length}</span>
            <span className="text-[#52525b]">products</span>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-full">
            <RefreshCw className="w-8 h-8 text-[#71717a] animate-spin mb-4" />
            <p className="text-[#71717a]">Loading products...</p>
          </div>
        ) : products.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full">
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/20 flex items-center justify-center mb-4">
              <Package className="w-10 h-10 text-indigo-400" />
            </div>
            <p className="text-lg text-[#a1a1aa] mb-2">No products in database</p>
            <p className="text-sm text-[#71717a]">Click "Seed Database" to populate products from CSV</p>
          </div>
        ) : (
          <div className="bg-[#121214] border border-[#2a2a2e] rounded-2xl overflow-hidden">
            <div className="h-1 w-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500" />
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-[#0a0a0b]">
                    <th className="text-left px-5 py-4 text-sm font-medium text-[#71717a]">
                      <div className="flex items-center gap-2">
                        <Hash className="w-4 h-4" />
                        ID
                      </div>
                    </th>
                    <th className="text-left px-5 py-4 text-sm font-medium text-[#71717a]">
                      <div className="flex items-center gap-2">
                        <Package className="w-4 h-4" />
                        Title
                      </div>
                    </th>
                    <th className="text-center px-5 py-4 text-sm font-medium text-[#71717a]">
                      <div className="flex items-center justify-center gap-2">
                        <Layers className="w-4 h-4" />
                        Units Relation
                      </div>
                    </th>
                    <th className="text-left px-5 py-4 text-sm font-medium text-[#71717a]">
                      <div className="flex items-center gap-2">
                        <Box className="w-4 h-4" />
                        Main Unit
                      </div>
                    </th>
                    <th className="text-left px-5 py-4 text-sm font-medium text-[#71717a]">
                      <div className="flex items-center gap-2">
                        <Box className="w-4 h-4" />
                        Secondary Unit
                      </div>
                    </th>
                    <th className="text-right px-5 py-4 text-sm font-medium text-[#71717a]">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#2a2a2e]">
                  {filteredProducts.map((product) => (
                    <tr
                      key={product.product_id}
                      className="hover:bg-[#1a1a1d] transition-colors"
                    >
                      <td className="px-5 py-4">
                        <span className="inline-flex items-center justify-center min-w-[2.5rem] px-2 py-1 bg-indigo-500/10 text-indigo-400 text-sm font-mono rounded-lg">
                          {product.product_id}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <span className="text-sm font-medium text-[#fafafa]">{product.title}</span>
                      </td>
                      <td className="px-5 py-4 text-center">
                        <span className="inline-flex items-center justify-center min-w-[2rem] px-2 py-1 bg-purple-500/10 text-purple-400 text-sm font-medium rounded-lg">
                          {product.units_relation}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <span className="text-sm text-[#a1a1aa]">{product.main_unit_description}</span>
                      </td>
                      <td className="px-5 py-4">
                        <span className="text-sm text-[#a1a1aa]">{product.secondary_unit_description}</span>
                      </td>
                      <td className="px-5 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => openEditDialog(product)}
                            className="p-2 text-[#71717a] hover:text-indigo-400 hover:bg-indigo-500/10 rounded-lg transition-colors"
                            title="Edit product"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => openDeleteDialog(product)}
                            className="p-2 text-[#71717a] hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                            title="Delete product"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Add/Edit Product Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="bg-[#121214] border-[#2a2a2e] text-[#fafafa] max-w-md">
          <DialogHeader>
            <DialogTitle>{editingProduct ? 'Edit Product' : 'Add New Product'}</DialogTitle>
            <DialogDescription className="text-[#71717a]">
              {editingProduct ? 'Update the product details below.' : 'Fill in the product details below.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div>
              <label className="text-sm font-medium text-[#a1a1aa] block mb-1.5">Product ID</label>
              <input
                type="text"
                value={formData.product_id}
                onChange={(e) => setFormData({ ...formData, product_id: e.target.value })}
                disabled={!!editingProduct}
                placeholder="e.g., 123"
                className="w-full px-3 py-2 bg-[#0a0a0b] border border-[#2a2a2e] rounded-lg text-[#fafafa] placeholder:text-[#52525b] focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
              />
            </div>

            <div>
              <label className="text-sm font-medium text-[#a1a1aa] block mb-1.5">Title</label>
              <input
                type="text"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="Product name"
                className="w-full px-3 py-2 bg-[#0a0a0b] border border-[#2a2a2e] rounded-lg text-[#fafafa] placeholder:text-[#52525b] focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label className="text-sm font-medium text-[#a1a1aa] block mb-1.5">Units Relation</label>
              <input
                type="number"
                value={formData.units_relation}
                onChange={(e) => setFormData({ ...formData, units_relation: parseInt(e.target.value) || 0 })}
                placeholder="10"
                className="w-full px-3 py-2 bg-[#0a0a0b] border border-[#2a2a2e] rounded-lg text-[#fafafa] placeholder:text-[#52525b] focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label className="text-sm font-medium text-[#a1a1aa] block mb-1.5">Main Unit Description</label>
              <input
                type="text"
                value={formData.main_unit_description}
                onChange={(e) => setFormData({ ...formData, main_unit_description: e.target.value })}
                placeholder="ΤΕΜΑΧΙΟ"
                className="w-full px-3 py-2 bg-[#0a0a0b] border border-[#2a2a2e] rounded-lg text-[#fafafa] placeholder:text-[#52525b] focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label className="text-sm font-medium text-[#a1a1aa] block mb-1.5">Secondary Unit Description</label>
              <input
                type="text"
                value={formData.secondary_unit_description}
                onChange={(e) => setFormData({ ...formData, secondary_unit_description: e.target.value })}
                placeholder="KOYTA"
                className="w-full px-3 py-2 bg-[#0a0a0b] border border-[#2a2a2e] rounded-lg text-[#fafafa] placeholder:text-[#52525b] focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <button
              onClick={closeDialog}
              className="px-4 py-2 bg-[#1a1a1d] hover:bg-[#27272a] text-[#a1a1aa] hover:text-[#fafafa] font-medium rounded-lg border border-[#2a2a2e] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveProduct}
              disabled={saving}
              className="px-4 py-2 bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-400 hover:to-purple-400 text-white font-medium rounded-lg shadow-lg transition-all duration-200 flex items-center gap-2 disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Saving...' : 'Save'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <DeleteConfirmationDialog
        isOpen={deleteDialogOpen}
        onClose={() => {
          setDeleteDialogOpen(false);
          setProductToDelete(null);
        }}
        onConfirm={handleDeleteProduct}
        title="Delete Product"
        description={`Are you sure you want to delete "${productToDelete?.title}"? This action cannot be undone.`}
      />
    </div>
  );
}
