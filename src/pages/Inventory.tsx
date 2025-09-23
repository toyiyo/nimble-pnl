import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Search, Package, AlertTriangle, Edit, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BarcodeScanner } from '@/components/BarcodeScanner';
import { ImageCapture } from '@/components/ImageCapture';
import { ProductDialog } from '@/components/ProductDialog';
import { ProductCard } from '@/components/ProductCard';
import { ProductUpdateDialog } from '@/components/ProductUpdateDialog';
import { DeleteProductDialog } from '@/components/DeleteProductDialog';
import { useProducts, CreateProductData, Product } from '@/hooks/useProducts';
import { useRestaurants } from '@/hooks/useRestaurants';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { productLookupService, ProductLookupResult } from '@/services/productLookupService';
import { ProductEnhancementService } from '@/services/productEnhancementService';
import { ocrService } from '@/services/ocrService';

export const Inventory: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { restaurants } = useRestaurants();
  const { toast } = useToast();
  
  // For now, use the first restaurant. In a full app, you'd have restaurant selection
  const selectedRestaurant = restaurants[0];
  const { products, loading, createProduct, updateProduct, deleteProduct, findProductByGtin } = useProducts(selectedRestaurant?.restaurant?.id || null);
  
  const [searchTerm, setSearchTerm] = useState('');
  const [showProductDialog, setShowProductDialog] = useState(false);
  const [showUpdateDialog, setShowUpdateDialog] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [scannedProductData, setScannedProductData] = useState<Partial<CreateProductData> | null>(null);
  const [lookupResult, setLookupResult] = useState<ProductLookupResult | null>(null);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [lastScannedGtin, setLastScannedGtin] = useState<string>('');
  const [currentMode, setCurrentMode] = useState<'barcode' | 'image'>('barcode');
  const [capturedImage, setCapturedImage] = useState<{ blob: Blob; url: string } | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [productToDelete, setProductToDelete] = useState<Product | null>(null);

  const handleBarcodeScanned = async (gtin: string, format: string) => {
    console.log('📱 Barcode scanned:', gtin, format);
    setLastScannedGtin(gtin);
    setLookupResult(null);
    
    // Check if product already exists in inventory
    const existingProduct = await findProductByGtin(gtin);
    
    if (existingProduct) {
      setSelectedProduct(existingProduct);
      setShowUpdateDialog(true);
      toast({
        title: "Product found in inventory",
        description: `${existingProduct.name} - Update details or add stock`,
      });
      return;
    }

    // Look up product information with enhanced catalog lookup
    setIsLookingUp(true);
    try {
      const result = await productLookupService.lookupProduct(gtin, findProductByGtin);
      
      // Create a new product object with lookup data for the update dialog
      const newProductData: Product = {
        id: '', // Will be generated on creation
        restaurant_id: selectedRestaurant!.restaurant!.id,
        gtin: gtin,
        sku: gtin,
        name: result?.product_name || 'New Product',
        description: null,
        brand: result?.brand || '',
        category: result?.category || '',
        size_value: result?.package_size_value || null,
        size_unit: result?.package_size_unit || null,
        package_qty: result?.package_qty || 1,
        uom_purchase: null,
        uom_recipe: null,
        conversion_factor: 1,
        cost_per_unit: null,
        current_stock: 0,
        par_level_min: 0,
        par_level_max: 0,
        reorder_point: 0,
        supplier_name: null,
        supplier_sku: null,
        barcode_data: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      setSelectedProduct(newProductData);
      setShowUpdateDialog(true);
      
      if (result) {
        toast({
          title: "Product identified",
          description: `Found: ${result.product_name} - Add details and quantity`,
        });
      } else {
        toast({
          title: "New product scanned",
          description: "Add product details and initial quantity",
        });
      }
    } catch (error) {
      console.error('Product lookup error:', error);
      toast({
        title: "Lookup failed",
        description: "Failed to look up product information",
        variant: "destructive",
      });
    } finally {
      setIsLookingUp(false);
    }
  };

  const handleImageCaptured = async (imageBlob: Blob, imageUrl: string) => {
    console.log('📸 Image captured for analysis');
    setCapturedImage({ blob: imageBlob, url: imageUrl });
    setIsLookingUp(true);

    try {
      // First try OCR to extract text and identify product
      const ocrResult = await productLookupService.identifyFromImage(imageBlob, ocrService);
      
      if (ocrResult && ocrResult.product_name) {
        setLookupResult(ocrResult);
        toast({
          title: "Product identified from image",
          description: `Found: ${ocrResult.product_name}`,
        });
      } else {
        // If OCR doesn't find anything, show manual entry with any extracted text
        setLookupResult({
          gtin: '',
          gtin14: '',
          product_name: '',
          source: 'manual',
          resolution: 'unknown',
          confidence_score: 0
        });
        toast({
          title: "Product analysis completed",
          description: "No text found. You can add the product manually.",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error('Image analysis error:', error);
      toast({
        title: "Analysis failed",
        description: "Failed to analyze image. Please try again.",
        variant: "destructive",
      });
      setLookupResult(null);
    } finally {
      setIsLookingUp(false);
    }
  };

  const handleCreateProduct = async (productData: CreateProductData) => {
    const newProduct = await createProduct(productData);
    if (newProduct) {
      setShowProductDialog(false);
      setScannedProductData(null);
      setLookupResult(null);
      setLastScannedGtin('');
      setCapturedImage(null);
    }
  };

  const handleAddToInventory = (productData: CreateProductData) => {
    handleCreateProduct(productData);
  };

  const handleCreateManually = () => {
    // Pre-fill with any available data from OCR or barcode scan
    const baseData = {
      restaurant_id: selectedRestaurant!.restaurant!.id,
      gtin: lastScannedGtin || lookupResult?.gtin || '',
      sku: lastScannedGtin || lookupResult?.gtin || '',
      name: lookupResult?.product_name || '',
      brand: lookupResult?.brand || '',
      category: lookupResult?.category || '',
    };
    
    setScannedProductData(baseData);
    setShowProductDialog(true);
  };

  const handleUpdateProduct = async (updates: Partial<Product>, quantityToAdd: number) => {
    if (!selectedProduct) return;
    
    // Check if this is a new product (no ID) or existing product
    if (!selectedProduct.id) {
      // Create new product
      const productData: CreateProductData = {
        restaurant_id: selectedProduct.restaurant_id,
        gtin: selectedProduct.gtin,
        sku: selectedProduct.sku,
        name: updates.name || selectedProduct.name,
        description: updates.description || selectedProduct.description,
        brand: updates.brand || selectedProduct.brand,
        category: updates.category || selectedProduct.category,
        size_value: selectedProduct.size_value,
        size_unit: updates.size_unit || selectedProduct.size_unit,
        package_qty: selectedProduct.package_qty,
        uom_purchase: updates.uom_purchase || selectedProduct.uom_purchase,
        uom_recipe: selectedProduct.uom_recipe,
        conversion_factor: selectedProduct.conversion_factor,
        cost_per_unit: updates.cost_per_unit || selectedProduct.cost_per_unit,
        current_stock: quantityToAdd, // Set initial stock to the quantity being added
        par_level_min: selectedProduct.par_level_min,
        par_level_max: selectedProduct.par_level_max,
        reorder_point: selectedProduct.reorder_point,
        supplier_name: updates.supplier_name || selectedProduct.supplier_name,
        supplier_sku: selectedProduct.supplier_sku,
        barcode_data: selectedProduct.barcode_data,
      };

      const newProduct = await createProduct(productData);
      if (newProduct) {
        toast({
          title: "Product created",
          description: `${newProduct.name} added to inventory with ${quantityToAdd} units`,
        });
        setShowUpdateDialog(false);
        setSelectedProduct(null);
      }
    } else {
      // Update existing product
      const success = await updateProduct(selectedProduct.id, updates);
      if (success && quantityToAdd > 0) {
        toast({
          title: "Inventory updated",
          description: `Added ${quantityToAdd} units. New total: ${(selectedProduct.current_stock || 0) + quantityToAdd}`,
        });
      }
      setShowUpdateDialog(false);
      setSelectedProduct(null);
    }
  };

  const handleEnhanceProduct = async (product: Product) => {
    return await ProductEnhancementService.enhanceProduct(product);
  };

  const handleDeleteProduct = (product: Product) => {
    setProductToDelete(product);
    setShowDeleteDialog(true);
  };

  const handleConfirmDelete = async () => {
    if (!productToDelete) return;
    
    const success = await deleteProduct(productToDelete.id);
    if (success) {
      setShowDeleteDialog(false);
      setProductToDelete(null);
    }
  };

  // Check if user has permission to delete products
  const canDeleteProducts = selectedRestaurant?.role === 'owner' || selectedRestaurant?.role === 'manager';

  const filteredProducts = products.filter(product =>
    product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    product.sku.toLowerCase().includes(searchTerm.toLowerCase()) ||
    product.brand?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    product.category?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const lowStockProducts = products.filter(product => 
    (product.current_stock || 0) <= (product.reorder_point || 0)
  );

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-4">Access Denied</h2>
          <p className="text-muted-foreground mb-4">Please sign in to access inventory management.</p>
          <Button onClick={() => navigate('/auth')}>Sign In</Button>
        </div>
      </div>
    );
  }

  if (!selectedRestaurant) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-4">No Restaurant Selected</h2>
          <p className="text-muted-foreground mb-4">Please select a restaurant to manage inventory.</p>
          <Button onClick={() => navigate('/')}>Go to Dashboard</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-card border-b border-border p-4">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/')}
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Dashboard
            </Button>
            <div>
              <h1 className="text-2xl font-bold">Inventory Management</h1>
              <p className="text-muted-foreground">{selectedRestaurant?.restaurant?.name}</p>
            </div>
          </div>
          <Button onClick={() => setShowProductDialog(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Product
          </Button>
        </div>
      </header>

      <div className="max-w-7xl mx-auto p-6">
        <Tabs defaultValue="scanner" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="scanner">
              Scanner {currentMode === 'barcode' ? '📱' : '📸'}
            </TabsTrigger>
            <TabsTrigger value="products">Products ({products.length})</TabsTrigger>
            <TabsTrigger value="low-stock">
              Low Stock 
              {lowStockProducts.length > 0 && (
                <Badge variant="destructive" className="ml-2">
                  {lowStockProducts.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="categories">Categories</TabsTrigger>
          </TabsList>

          <TabsContent value="scanner" className="mt-6">
            <div className="space-y-6">
              {/* Mode Toggle */}
              <div className="flex justify-center">
                <div className="bg-muted p-1 rounded-lg">
                  <Button
                    variant={currentMode === 'barcode' ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => setCurrentMode('barcode')}
                  >
                    📱 Barcode
                  </Button>
                  <Button
                    variant={currentMode === 'image' ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => setCurrentMode('image')}
                  >
                    📸 Image
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div>
                  {currentMode === 'barcode' ? (
                    <BarcodeScanner
                      onScan={handleBarcodeScanned}
                      onError={(error) => toast({
                        title: "Scanner Error",
                        description: error,
                        variant: "destructive",
                      })}
                      autoStart={false}
                    />
                  ) : (
                    <ImageCapture
                      onImageCaptured={handleImageCaptured}
                      onError={(error) => toast({
                        title: "Image Error",
                        description: error,
                        variant: "destructive",
                      })}
                    />
                  )}
                </div>
                <div>
                  <Card>
                    <CardHeader>
                      <CardTitle>How to Scan</CardTitle>
                      <CardDescription>
                        Tips for best scanning results
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {currentMode === 'barcode' ? (
                        <>
                          <div className="space-y-2">
                            <h4 className="font-medium">Supported Barcodes:</h4>
                            <ul className="text-sm text-muted-foreground space-y-1">
                              <li>• UPC-A & UPC-E (12 digits)</li>
                              <li>• EAN-13 & EAN-8</li>
                              <li>• Code 128</li>
                              <li>• QR Codes</li>
                              <li>• Data Matrix</li>
                            </ul>
                          </div>
                          <div className="space-y-2">
                            <h4 className="font-medium">Scanning Tips:</h4>
                            <ul className="text-sm text-muted-foreground space-y-1">
                              <li>• Hold the barcode steady within the frame</li>
                              <li>• Ensure good lighting</li>
                              <li>• Keep the barcode flat and un-wrinkled</li>
                              <li>• Try different distances if scanning fails</li>
                            </ul>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="space-y-2">
                            <h4 className="font-medium">Image Analysis:</h4>
                            <ul className="text-sm text-muted-foreground space-y-1">
                              <li>• Automatically detects text on packages</li>
                              <li>• Identifies brand names and product info</li>
                              <li>• Extracts size and quantity information</li>
                              <li>• Works when barcodes are damaged/missing</li>
                            </ul>
                          </div>
                          <div className="space-y-2">
                            <h4 className="font-medium">Photo Tips:</h4>
                            <ul className="text-sm text-muted-foreground space-y-1">
                              <li>• Ensure clear, readable text</li>
                              <li>• Use good lighting</li>
                              <li>• Focus on product labels</li>
                              <li>• Avoid reflections and shadows</li>
                            </ul>
                          </div>
                        </>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </div>
              
              {(lookupResult || isLookingUp || lastScannedGtin || capturedImage) && (
                <div className="flex justify-center">
                  <ProductCard
                    product={lookupResult}
                    gtin={lastScannedGtin || lookupResult?.gtin || ''}
                    onAddToInventory={handleAddToInventory}
                    onCreateManually={handleCreateManually}
                    restaurantId={selectedRestaurant?.restaurant?.id || ''}
                    isLoading={isLookingUp}
                  />
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="products" className="mt-6">
            <div className="space-y-6">
              <div className="flex items-center gap-4">
                <div className="relative flex-1 max-w-md">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search products..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>

              {loading ? (
                <div className="text-center py-8">
                  <Package className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">Loading products...</p>
                </div>
              ) : filteredProducts.length === 0 ? (
                <div className="text-center py-8">
                  <Package className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">
                    {searchTerm ? 'No products found matching your search.' : 'No products in inventory yet.'}
                  </p>
                  <Button 
                    className="mt-4" 
                    onClick={() => setShowProductDialog(true)}
                  >
                    Add Your First Product
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredProducts.map((product) => (
                    <Card key={product.id} className="cursor-pointer hover:shadow-md transition-shadow">
                      <CardHeader>
                        <div className="flex items-start justify-between">
                          <div>
                            <CardTitle className="text-lg">{product.name}</CardTitle>
                            <CardDescription>SKU: {product.sku}</CardDescription>
                          </div>
                          <div className="flex items-center gap-2">
                            {(product.current_stock || 0) <= (product.reorder_point || 0) && (
                              <AlertTriangle className="h-5 w-5 text-destructive" />
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedProduct(product);
                                setShowUpdateDialog(true);
                              }}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            {canDeleteProducts && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteProduct(product);
                                }}
                                className="text-destructive hover:text-destructive"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent
                        onClick={() => {
                          setSelectedProduct(product);
                          setShowUpdateDialog(true);
                        }}
                      >
                        <div className="space-y-2">
                          {product.brand && (
                            <p className="text-sm text-muted-foreground">Brand: {product.brand}</p>
                          )}
                          {product.category && (
                            <Badge variant="secondary">{product.category}</Badge>
                          )}
                          <div className="flex justify-between items-center">
                            <span className="text-sm">Stock:</span>
                            <span className={`font-medium ${
                              (product.current_stock || 0) <= (product.reorder_point || 0) 
                                ? 'text-destructive' 
                                : 'text-foreground'
                            }`}>
                              {product.current_stock || 0} {product.size_unit || 'units'}
                            </span>
                          </div>
                          {product.cost_per_unit && (
                            <div className="flex justify-between items-center">
                              <span className="text-sm">Cost:</span>
                              <span className="font-medium">${product.cost_per_unit}</span>
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="low-stock" className="mt-6">
            <div className="space-y-6">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-destructive" />
                <h2 className="text-xl font-semibold">Low Stock Alert</h2>
              </div>

              {lowStockProducts.length === 0 ? (
                <Card>
                  <CardContent className="py-8 text-center">
                    <Package className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <p className="text-muted-foreground">All products are well stocked!</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {lowStockProducts.map((product) => (
                    <Card key={product.id} className="border-destructive">
                      <CardHeader>
                        <div className="flex items-start justify-between">
                          <div>
                            <CardTitle className="text-lg">{product.name}</CardTitle>
                            <CardDescription>SKU: {product.sku}</CardDescription>
                          </div>
                          <AlertTriangle className="h-5 w-5 text-destructive" />
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2">
                          <div className="flex justify-between items-center">
                            <span className="text-sm">Current Stock:</span>
                            <span className="font-medium text-destructive">
                              {product.current_stock || 0} {product.size_unit || 'units'}
                            </span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-sm">Reorder Point:</span>
                            <span className="font-medium">
                              {product.reorder_point || 0} {product.size_unit || 'units'}
                            </span>
                          </div>
                          <Button className="w-full mt-4" size="sm">
                            Reorder Now
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="categories" className="mt-6">
            <div className="text-center py-8">
              <Package className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">Category management coming soon...</p>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <ProductDialog
        open={showProductDialog}
        onOpenChange={setShowProductDialog}
        onSubmit={handleCreateProduct}
        restaurantId={selectedRestaurant?.restaurant?.id || ''}
        initialData={scannedProductData}
      />

      {selectedProduct && (
        <ProductUpdateDialog
          open={showUpdateDialog}
          onOpenChange={setShowUpdateDialog}
          product={selectedProduct}
          onUpdate={handleUpdateProduct}
          onEnhance={handleEnhanceProduct}
        />
      )}
      {/* Delete Product Dialog */}
      <DeleteProductDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        product={productToDelete}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
};