import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Search, Package, AlertTriangle, Edit, Trash2, ArrowRightLeft, Trash } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EnhancedBarcodeScanner } from '@/components/EnhancedBarcodeScanner';
import { ImageCapture } from '@/components/ImageCapture';
import { ProductDialog } from '@/components/ProductDialog';
import { ProductCard } from '@/components/ProductCard';
import { ProductUpdateDialog } from '@/components/ProductUpdateDialog';
import { DeleteProductDialog } from '@/components/DeleteProductDialog';
import { WasteDialog } from '@/components/WasteDialog';
import { TransferDialog } from '@/components/TransferDialog';
import { QuickInventoryDialog } from '@/components/QuickInventoryDialog';
import { RestaurantSelector } from '@/components/RestaurantSelector';
import { ReconciliationHistory } from '@/components/ReconciliationHistory';
import { ReconciliationSession } from '@/components/ReconciliationSession';
import { ReconciliationSummary } from '@/components/ReconciliationSummary';
import { useReconciliation } from '@/hooks/useReconciliation';
import { InventorySettings } from '@/components/InventorySettings';
import { InventoryValueBadge } from '@/components/InventoryValueBadge';
import { useProducts, CreateProductData, Product } from '@/hooks/useProducts';
import { useInventoryAudit } from '@/hooks/useInventoryAudit';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useAuth } from '@/hooks/useAuth';
import { useInventoryMetrics } from '@/hooks/useInventoryMetrics';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { productLookupService, ProductLookupResult } from '@/services/productLookupService';
import { ProductEnhancementService } from '@/services/productEnhancementService';
import { ocrService } from '@/services/ocrService';

export const Inventory: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { selectedRestaurant, setSelectedRestaurant, restaurants, loading: restaurantsLoading, createRestaurant } = useRestaurantContext();
  const { toast } = useToast();
  
  const { products, loading, createProduct, updateProductWithQuantity, deleteProduct, findProductByGtin, refetchProducts } = useProducts(selectedRestaurant?.restaurant_id || null);
  const { updateProductStockWithAudit } = useInventoryAudit();
  const inventoryMetrics = useInventoryMetrics(selectedRestaurant?.restaurant_id || null, products);
  
  const [searchTerm, setSearchTerm] = useState('');
  const [showProductDialog, setShowProductDialog] = useState(false);
  const [showUpdateDialog, setShowUpdateDialog] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [scannedProductData, setScannedProductData] = useState<Partial<CreateProductData> | null>(null);
  const [lookupResult, setLookupResult] = useState<ProductLookupResult | null>(null);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [lastScannedGtin, setLastScannedGtin] = useState<string>('');
  const [currentMode, setCurrentMode] = useState<'scanner' | 'image'>('scanner');
  const [capturedImage, setCapturedImage] = useState<{ blob: Blob; url: string } | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [productToDelete, setProductToDelete] = useState<Product | null>(null);
  const [showWasteDialog, setShowWasteDialog] = useState(false);
  const [showTransferDialog, setShowTransferDialog] = useState(false);
  const [wasteProduct, setWasteProduct] = useState<Product | null>(null);
  const [transferProduct, setTransferProduct] = useState<Product | null>(null);
  const [activeTab, setActiveTab] = useState('scanner');
  const [showQuickInventoryDialog, setShowQuickInventoryDialog] = useState(false);
  const [quickInventoryProduct, setQuickInventoryProduct] = useState<Product | null>(null);
  const [scanMode, setScanMode] = useState<'add' | 'reconcile'>('add');
  const [reconciliationView, setReconciliationView] = useState<'history' | 'session' | 'summary'>('history');
  const { activeSession, startReconciliation } = useReconciliation(selectedRestaurant?.restaurant_id || null);

  const handleRestaurantSelect = (restaurant: any) => {
    setSelectedRestaurant(restaurant);
  };

  if (!selectedRestaurant) {
    return (
      <div className="space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold mb-2">Inventory Management</h1>
          <p className="text-muted-foreground">
            Manage your restaurant's inventory and track stock levels
          </p>
        </div>
        <RestaurantSelector
          restaurants={restaurants}
          selectedRestaurant={selectedRestaurant}
          onSelectRestaurant={handleRestaurantSelect}
          loading={restaurantsLoading}
          createRestaurant={createRestaurant}
        />
      </div>
    );
  }

  const handleBarcodeScanned = async (gtin: string, format: string, aiData?: string) => {
    console.log('📱 Barcode scanned:', gtin, format, aiData ? 'with AI data' : '');
    
    setLastScannedGtin(gtin);
    setLookupResult(null);
    
    // For manual entry with AI data, create product directly
    if (gtin === 'MANUAL_ENTRY' && aiData) {
      // Parse AI data to extract product information
      const lines = aiData.split('\n').filter(line => line.trim().length > 0);
      const productName = lines[0] || 'AI Detected Product';
      const brandMatch = lines.find(line => /brand|company|corp|inc|llc/i.test(line));
      const sizeMatch = lines.find(line => /\d+\s*(fl oz|oz|ml|gram|kg|lb)/i.test(line));
      
      const newProductData: Product = {
        id: '',
        restaurant_id: selectedRestaurant!.restaurant!.id,
        gtin: '',
        sku: `AI_${Date.now()}`,
        name: productName,
        description: lines.slice(1, 4).join(' • '),
        brand: brandMatch || '',
        category: '',
        size_value: null,
        size_unit: sizeMatch?.match(/fl oz|oz|ml|gram|kg|lb/i)?.[0] || null,
        package_qty: 1,
        uom_purchase: null,
        uom_recipe: null,
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
      toast({
        title: "AI Product Detected",
        description: `${productName} - Add barcode and details`,
      });
      return;
    }
    
    // Check if product already exists in inventory
    const existingProduct = await findProductByGtin(gtin);
    
    if (existingProduct) {
      // Use quick inventory dialog for scanning existing products
      setQuickInventoryProduct(existingProduct);
      setShowQuickInventoryDialog(true);
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
          description: `${result.product_name} - Add details then scan again for quick entry`,
        });
      } else {
        toast({
          title: "New product scanned",
          description: "Add product details - scan again later for quick entry",
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
      // Upload image to storage first
      const uploadedImageUrl = await uploadImageToStorage(imageBlob);
      
      // Enhanced flow: Grok OCR → Web Search → AI Enhancement
      console.log('🚀 Starting enhanced product identification...');
      
      // Step 1: Use Grok OCR to extract text
      const { supabase } = await import('@/integrations/supabase/client');
      
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;
      const img = new Image();
      
      const grokOCRResult = await new Promise<{ text: string; confidence: number }>((resolve, reject) => {
        img.onload = async () => {
          canvas.width = img.width;
          canvas.height = img.height;
          ctx.drawImage(img, 0, 0);
          
          const imageData = canvas.toDataURL('image/png');
          
          console.log('🔍 Processing with Grok OCR...');
          const response = await supabase.functions.invoke('grok-ocr', {
            body: { imageData }
          });
          
          if (response.error) {
            reject(new Error(response.error.message));
            return;
          }
          
          resolve(response.data);
        };
        
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = imageUrl;
      });
      
      console.log('✅ Grok OCR completed:', grokOCRResult);
      
      // Use structured data from OCR if available
      const ocrData = (grokOCRResult as any).structuredData;
      
      // Step 2: Use OCR text for web search to get additional structured data (optional enhancement)
      let enhancedData = null;
      const searchQuery = ocrData?.productName || grokOCRResult.text?.trim();
      
      if (searchQuery && !ocrData) {
        // Only do web search if we didn't get structured data from OCR
        console.log('🌐 Searching for product information...');
        const searchResponse = await supabase.functions.invoke('web-search', {
          body: { 
            query: `${searchQuery} product information nutrition ingredients`,
            maxResults: 5 
          }
        });
        
        if (!searchResponse.error && searchResponse.data?.results?.length > 0) {
          // Step 3: Use AI to enhance product data with search results
          console.log('🤖 Enhancing product data with AI...');
          const enhanceResponse = await supabase.functions.invoke('enhance-product-ai', {
            body: {
              searchText: searchResponse.data.results.map((r: any) => r.content).join('\n\n'),
              productName: searchQuery,
              brand: '',
              category: '',
              currentDescription: ''
            }
          });
          
          if (!enhanceResponse.error) {
            enhancedData = enhanceResponse.data;
            console.log('✅ AI enhancement completed:', enhancedData);
          }
        }
      }
      
      // Parse size value and unit from OCR data
      let sizeValue = null;
      let sizeUnit = null;
      
      if (ocrData?.sizeValue && ocrData?.sizeUnit) {
        sizeValue = parseFloat(ocrData.sizeValue);
        sizeUnit = ocrData.sizeUnit;
      } else if (enhancedData?.sizeValue) {
        sizeValue = enhancedData.sizeValue;
        sizeUnit = enhancedData.sizeUnit;
      }
      
      // Create product data with structured OCR information and image
      const newProductData: Product = {
        id: '', // Will be generated on creation
        restaurant_id: selectedRestaurant!.restaurant!.id,
        gtin: ocrData?.upcBarcode || enhancedData?.gtin || '',
        sku: ocrData?.upcBarcode || enhancedData?.gtin || Date.now().toString(),
        name: ocrData?.productName || enhancedData?.productName || grokOCRResult.text || 'New Product',
        description: ocrData?.ingredients || ocrData?.nutritionFacts || enhancedData?.description || null,
        brand: ocrData?.brand || enhancedData?.brand || '',
        category: enhancedData?.category || '',
        size_value: sizeValue,
        size_unit: sizeUnit,
        package_qty: enhancedData?.packageQty || 1,
        uom_purchase: sizeUnit || null,
        uom_recipe: null,
        cost_per_unit: null,
        current_stock: 0,
        par_level_min: 0,
        par_level_max: 0,
        reorder_point: 0,
        supplier_name: ocrData?.supplier || null,
        supplier_sku: ocrData?.batchLot || null,
        pos_item_name: ocrData?.productName || enhancedData?.productName || grokOCRResult.text || '',
        image_url: uploadedImageUrl, // Use the captured image
        barcode_data: ocrData?.upcBarcode || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      setSelectedProduct(newProductData);
      setShowUpdateDialog(true);
      
      const productDisplayName = ocrData?.productName || enhancedData?.productName || grokOCRResult.text;
      if (productDisplayName) {
        toast({
          title: "Product identified from image",
          description: `${ocrData?.brand ? ocrData.brand + ' ' : ''}${productDisplayName}${ocrData?.packageDescription ? ' - ' + ocrData.packageDescription : ''}`,
        });
      } else {
        toast({
          title: "Image captured",
          description: "Add product details - scan again later for quick entry",
        });
      }
    } catch (error) {
      console.error('Enhanced image analysis error:', error);
      toast({
        title: "Analysis failed", 
        description: "Failed to analyze image. You can still add the product manually.",
        variant: "destructive",
      });
      
      // Fallback: still allow manual entry with the image
      try {
        const uploadedImageUrl = await uploadImageToStorage(imageBlob);
        const fallbackProductData: Product = {
          id: '',
          restaurant_id: selectedRestaurant!.restaurant!.id,
          gtin: '',
          sku: Date.now().toString(),
          name: 'New Product',
          description: null,
          brand: '',
          category: '',
          size_value: null,
          size_unit: null,
          package_qty: 1,
          uom_purchase: null,
          uom_recipe: null,
          cost_per_unit: null,
          current_stock: 0,
          par_level_min: 0,
          par_level_max: 0,
          reorder_point: 0,
          supplier_name: null,
          supplier_sku: null,
          pos_item_name: '',
          image_url: uploadedImageUrl,
          barcode_data: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        
        setSelectedProduct(fallbackProductData);
        setShowUpdateDialog(true);
      } catch (uploadError) {
        console.error('Image upload failed:', uploadError);
      }
    } finally {
      setIsLookingUp(false);
    }
  };

  const uploadImageToStorage = async (imageBlob: Blob): Promise<string> => {
    const { supabase } = await import('@/integrations/supabase/client');
    
    const fileExt = 'jpg';
    const fileName = `${Math.random().toString(36).substring(2)}.${fileExt}`;
    const filePath = `${selectedRestaurant?.restaurant?.id}/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from('product-images')
      .upload(filePath, imageBlob);

    if (uploadError) throw uploadError;

    const { data } = supabase.storage
      .from('product-images')
      .getPublicUrl(filePath);

    return data.publicUrl;
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
    // Create a new product object for manual entry (same flow as barcode scanner)
    const newProductData: Product = {
      id: '', // Will be generated on creation
      restaurant_id: selectedRestaurant!.restaurant!.id,
      gtin: lastScannedGtin || lookupResult?.gtin || '',
      sku: '', // User will fill this in
      name: lookupResult?.product_name || '',
      description: null,
      brand: lookupResult?.brand || '',
      category: lookupResult?.category || '',
      size_value: null,
      size_unit: null,
      package_qty: 1,
      uom_purchase: null,
      uom_recipe: null,
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
      // Update existing product with proper audit trail
      const currentStock = selectedProduct.current_stock || 0;
      const finalStock = updates.current_stock ?? currentStock; // Use nullish coalescing to preserve 0 values
      const difference = finalStock - currentStock;
      
      try {
        // First update the product in database
        const { error } = await supabase
          .from('products')
          .update({
            ...updates,
            updated_at: new Date().toISOString()
          })
          .eq('id', selectedProduct.id);
        
        if (error) throw error;
        
        // Then create audit trail if there's a stock change
        if (difference !== 0) {
          let transactionType: 'purchase' | 'adjustment' | 'waste';
          let reason: string;
          
          if (difference === quantityToAdd && quantityToAdd > 0) {
            // This is an additive purchase
            transactionType = 'purchase';
            reason = 'Purchase - Inventory addition';
          } else {
            // This is an adjustment (exact count was set)
            transactionType = 'adjustment';
            reason = difference >= 0 
              ? 'Adjustment - Manual correction (count increase)'
              : 'Adjustment - Manual correction (count decrease)';
          }
          
          await updateProductStockWithAudit(
            selectedRestaurant!.restaurant_id!,
            selectedProduct.id,
            finalStock,
            currentStock,
            updates.cost_per_unit || selectedProduct.cost_per_unit || 0,
            transactionType,
            reason,
            `${transactionType}_${selectedProduct.id}_${Date.now()}`
          );
        }
        
        // Show success message
        const quantityDifference = Math.round((finalStock - currentStock) * 100) / 100;
        const isAdjustment = difference !== quantityToAdd;
        if (quantityDifference !== 0) {
          toast({
            title: "Inventory updated",
            description: `${isAdjustment ? 'Adjustment' : 'Addition'}: ${quantityDifference >= 0 ? '+' : ''}${quantityDifference} units. New total: ${Math.round(finalStock * 100) / 100}`,
            duration: 800,
          });
        } else {
          toast({
            title: "Product updated", 
            description: "Product information has been updated",
            duration: 800,
          });
        }
        
      } catch (error: any) {
        console.error('Error updating product:', error);
        toast({
          title: "Error updating product",
          description: error.message,
          variant: "destructive",
        });
        return;
      }
      
        // Refresh products to ensure UI is in sync
        refetchProducts();
        
        setShowUpdateDialog(false);
        setSelectedProduct(null);
    }
  };

  const handleEnhanceProduct = async (product: Product) => {
    return await ProductEnhancementService.enhanceProduct(product);
  };

  const handleQuickInventorySave = async (quantity: number) => {
    if (!quickInventoryProduct || !selectedRestaurant) return;

    const currentStock = quickInventoryProduct.current_stock || 0;
    const costPerUnit = quickInventoryProduct.cost_per_unit || 0;
    
    let finalStock: number;
    let transactionType: 'purchase' | 'adjustment';
    let reason: string;
    
    if (scanMode === 'add') {
      // Add mode: add to existing stock
      finalStock = currentStock + quantity;
      transactionType = 'purchase';
      reason = `Purchase - Added ${quantity} via quick scan`;
    } else {
      // Reconcile mode: set total stock to scanned quantity
      finalStock = quantity;
      transactionType = 'adjustment';
      reason = `Inventory reconciliation - Set to ${quantity} via quick scan`;
    }
    
    const success = await updateProductStockWithAudit(
      selectedRestaurant.restaurant_id,
      quickInventoryProduct.id,
      finalStock,
      currentStock,
      costPerUnit,
      transactionType,
      reason,
      `quick_scan_${Date.now()}`
    );
    
    if (success) {
      await refetchProducts();
      toast({
        title: "Inventory updated",
        description: scanMode === 'add' 
          ? `Added ${quantity} to ${quickInventoryProduct.name}`
          : `Set ${quickInventoryProduct.name} to ${quantity}`,
        duration: 800,
      });
    }
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
        <div className="max-w-7xl mx-auto">
          {/* Mobile-first layout */}
          <div className="flex items-center justify-between mb-3 md:mb-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/')}
              className="p-2 md:px-3"
            >
              <ArrowLeft className="h-4 w-4 md:mr-2" />
              <span className="hidden md:inline">Dashboard</span>
            </Button>
            <div className="flex gap-2">
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => navigate('/receipt-import')}
                className="p-2 md:px-3"
              >
                <Package className="h-4 w-4 md:mr-2" />
                <span className="hidden md:inline">Upload Receipt</span>
              </Button>
              <Button onClick={handleCreateManually} size="sm">
                <Plus className="h-4 w-4 md:mr-2" />
                <span className="hidden sm:inline">Add Product</span>
              </Button>
            </div>
          </div>
          <div className="text-center md:text-left">
            <h1 className="text-xl md:text-2xl font-bold">Inventory Management</h1>
            <p className="text-sm text-muted-foreground">{selectedRestaurant?.restaurant?.name}</p>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto p-4 md:p-6">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-2 md:grid-cols-5 h-auto">
            <TabsTrigger value="scanner" className="flex-col py-2 px-1">
              <span className="text-xs md:text-sm">Scanner</span>
              <span className="text-lg">{currentMode === 'scanner' ? '📱' : '📸'}</span>
            </TabsTrigger>
            <TabsTrigger value="products" className="flex-col py-2 px-1">
              <span className="text-xs md:text-sm">Products</span>
              <span className="text-xs">({products.length})</span>
            </TabsTrigger>
            <TabsTrigger value="low-stock" className="flex-col py-2 px-1">
              <span className="text-xs md:text-sm">Low Stock</span>
              {lowStockProducts.length > 0 && (
                <Badge variant="destructive" className="text-xs h-4 px-1">
                  {lowStockProducts.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="reconciliation" className="flex-col py-2 px-1">
              <span className="text-xs md:text-sm">Reconcile</span>
              {activeSession && (
                <Badge className="text-xs h-4 px-1 bg-blue-500">Active</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="categories" className="flex-col py-2 px-1">
              <span className="text-xs md:text-sm">Settings</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="scanner" className="mt-4 md:mt-6">
            <div className="space-y-4 md:space-y-6">
              {/* Scan Mode Toggle - Add vs Reconcile */}
              <div className="flex justify-center">
                <div className="bg-card border border-border p-1 rounded-lg w-full max-w-md">
                  <div className="grid grid-cols-2 gap-1">
                    <Button
                      variant={scanMode === 'add' ? 'default' : 'ghost'}
                      size="sm"
                      onClick={() => setScanMode('add')}
                      className="flex-1"
                    >
                      ➕ Add Stock
                    </Button>
                    <Button
                      variant={scanMode === 'reconcile' ? 'default' : 'ghost'}
                      size="sm"
                      onClick={() => setScanMode('reconcile')}
                      className="flex-1"
                    >
                      ✓ Reconcile
                    </Button>
                  </div>
                </div>
              </div>

              {/* Scanner/Image Mode Toggle */}
              <div className="flex justify-center">
                <div className="bg-muted p-1 rounded-lg w-full max-w-md">
                  <div className="grid grid-cols-2 gap-1">
                    <Button
                      variant={currentMode === 'scanner' ? 'default' : 'ghost'}
                      size="sm"
                      onClick={() => setCurrentMode('scanner')}
                      className="flex-1"
                    >
                      📱 Scanner
                    </Button>
                    <Button
                      variant={currentMode === 'image' ? 'default' : 'ghost'}
                      size="sm"
                      onClick={() => setCurrentMode('image')}
                      className="flex-1"
                    >
                      📸 Image
                    </Button>
                  </div>
                </div>
              </div>

              <div className="space-y-6 lg:grid lg:grid-cols-2 lg:gap-8 lg:space-y-0">
                <div>
                  {currentMode === 'scanner' ? (
                    <EnhancedBarcodeScanner
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
                <div className="lg:block">
                  <Card className="hidden md:block">
                    <CardHeader>
                      <CardTitle>How to Scan</CardTitle>
                      <CardDescription>
                        Tips for best scanning results
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {currentMode === 'scanner' ? (
                        <>
                          <div className="space-y-2">
                            <h4 className="font-medium">Scanning Methods:</h4>
                            <ul className="text-sm text-muted-foreground space-y-1">
                              <li>• 📷 <strong>Camera:</strong> Traditional barcode scanning</li>
                              <li>• 📱 <strong>Bluetooth:</strong> Pair with professional scanners</li>
                            </ul>
                          </div>
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
                            <h4 className="font-medium">Camera Scanning Tips:</h4>
                            <ul className="text-sm text-muted-foreground space-y-1">
                              <li>• Hold the barcode steady within the frame</li>
                              <li>• Ensure good lighting</li>
                              <li>• Keep the barcode flat and un-wrinkled</li>
                              <li>• Try different distances if scanning fails</li>
                            </ul>
                          </div>
                          <div className="space-y-2">
                            <h4 className="font-medium">Bluetooth Scanner Setup:</h4>
                            <ul className="text-sm text-muted-foreground space-y-1">
                              <li>• Make sure your scanner is in pairing mode</li>
                              <li>• Use Chrome, Edge, or compatible browser</li>
                              <li>• Keep scanner close to your device</li>
                              <li>• Check scanner battery level</li>
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
              
              {(isLookingUp && currentMode === 'scanner') && (
                <div className="flex justify-center">
                  <Card className="w-full max-w-md">
                    <CardContent className="py-8 text-center">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
                      <p className="text-muted-foreground">Looking up product...</p>
                    </CardContent>
                  </Card>
                </div>
              )}
              
              {(isLookingUp && currentMode === 'image') && (
                <div className="flex justify-center">
                  <Card className="w-full max-w-md">
                    <CardContent className="py-8 text-center">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
                      <p className="text-muted-foreground">Analyzing image...</p>
                    </CardContent>
                  </Card>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="products" className="mt-6">
            <div className="space-y-6">
              {/* Inventory Summary */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg">Total Inventory Cost</CardTitle>
                    <CardDescription>Total value of all stock at cost price</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-orange-600">
                      {inventoryMetrics.loading ? (
                        <div className="animate-pulse bg-muted h-8 w-24 rounded"></div>
                      ) : (
                        `$${inventoryMetrics.totalInventoryCost.toFixed(2)}`
                      )}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg">Total Inventory Value</CardTitle>
                    <CardDescription>Potential revenue from all stock</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-green-600">
                      {inventoryMetrics.loading ? (
                        <div className="animate-pulse bg-muted h-8 w-24 rounded"></div>
                      ) : (
                        `$${inventoryMetrics.totalInventoryValue.toFixed(2)}`
                      )}
                    </div>
                    {!inventoryMetrics.loading && (
                      <div className="mt-3 space-y-1 text-sm text-muted-foreground">
                        <div className="flex justify-between">
                          <span>Recipe-based:</span>
                          <span>{inventoryMetrics.calculationSummary.recipeBasedCount} products</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Estimated:</span>
                          <span>{inventoryMetrics.calculationSummary.estimatedCount} products</span>
                        </div>
                        {inventoryMetrics.calculationSummary.mixedCount > 0 && (
                          <div className="flex justify-between">
                            <span>Mixed:</span>
                            <span>{inventoryMetrics.calculationSummary.mixedCount} products</span>
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

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
                         <div className="flex items-start gap-3">
                           {product.image_url && (
                             <div className="flex-shrink-0">
                               <img 
                                 src={product.image_url} 
                                 alt={product.name}
                                 className="w-16 h-16 object-cover rounded-lg border"
                               />
                             </div>
                           )}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                  <CardTitle className="text-lg truncate">{product.name}</CardTitle>
                                  <CardDescription className="truncate">SKU: {product.sku}</CardDescription>
                                </div>
                                 <div className="flex-shrink-0 flex flex-wrap items-center gap-1 max-w-[120px] sm:max-w-none">
                                   {(product.current_stock || 0) <= (product.reorder_point || 0) && (
                                     <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0" />
                                   )}
                                   <Button
                                     variant="ghost"
                                     size="sm"
                                     onClick={(e) => {
                                       e.stopPropagation();
                                       setSelectedProduct(product);
                                       setShowUpdateDialog(true);
                                     }}
                                     className="h-7 w-7 p-0 flex-shrink-0"
                                     title="Edit"
                                   >
                                     <Edit className="h-3 w-3" />
                                   </Button>
                                   <Button
                                     variant="ghost"
                                     size="sm"
                                     onClick={(e) => {
                                       e.stopPropagation();
                                       setWasteProduct(product);
                                       setShowWasteDialog(true);
                                     }}
                                     className="h-7 w-7 p-0 flex-shrink-0"
                                     title="Waste"
                                   >
                                     <Trash className="h-3 w-3" />
                                   </Button>
                                   <Button
                                     variant="ghost"
                                     size="sm"
                                     onClick={(e) => {
                                       e.stopPropagation();
                                       setTransferProduct(product);
                                       setShowTransferDialog(true);
                                     }}
                                     className="h-7 w-7 p-0 flex-shrink-0"
                                     title="Transfer"
                                   >
                                     <ArrowRightLeft className="h-3 w-3" />
                                   </Button>
                                   {canDeleteProducts && (
                                     <Button
                                       variant="ghost"
                                       size="sm"
                                       onClick={(e) => {
                                         e.stopPropagation();
                                         handleDeleteProduct(product);
                                       }}
                                       className="h-7 w-7 p-0 flex-shrink-0 text-destructive hover:text-destructive"
                                       title="Delete"
                                     >
                                       <Trash2 className="h-3 w-3" />
                                     </Button>
                                   )}
                                 </div>
                              </div>
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
                               <div className={`font-medium text-right ${
                                 (product.current_stock || 0) <= (product.reorder_point || 0) 
                                   ? 'text-destructive' 
                                   : 'text-foreground'
                               }`}>
                                 <span>{product.current_stock || 0} {product.uom_purchase || 'units'}</span>
                               </div>
                             </div>
                           {product.cost_per_unit && (
                             <div className="flex justify-between items-center">
                               <span className="text-sm">Unit Cost:</span>
                               <span className="font-medium">${product.cost_per_unit}</span>
                             </div>
                           )}
                           {inventoryMetrics.productMetrics[product.id] && (
                             <>
                               <div className="flex justify-between items-center">
                                 <span className="text-sm">Inventory Cost:</span>
                                 <span className="font-medium text-orange-600">
                                   ${inventoryMetrics.productMetrics[product.id].inventoryCost.toFixed(2)}
                                 </span>
                               </div>
                                <div className="flex justify-between items-center">
                                  <span className="text-sm">Inventory Value:</span>
                                  <span className="font-medium text-green-600">
                                    ${inventoryMetrics.productMetrics[product.id].inventoryValue.toFixed(2)}
                                  </span>
                                </div>
                                <div className="mt-2">
                                  <InventoryValueBadge
                                    calculationMethod={inventoryMetrics.productMetrics[product.id].calculationMethod}
                                    markupUsed={inventoryMetrics.productMetrics[product.id].markupUsed}
                                    category={product.category}
                                  />
                                </div>
                             </>
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
                         <div className="flex items-start gap-3">
                           {product.image_url && (
                             <div className="flex-shrink-0">
                               <img 
                                 src={product.image_url} 
                                 alt={product.name}
                                 className="w-16 h-16 object-cover rounded-lg border"
                               />
                             </div>
                           )}
                           <div className="flex-1 min-w-0">
                             <div className="flex items-start justify-between">
                               <div>
                                 <CardTitle className="text-lg">{product.name}</CardTitle>
                                 <CardDescription>SKU: {product.sku}</CardDescription>
                               </div>
                               <AlertTriangle className="h-5 w-5 text-destructive" />
                             </div>
                           </div>
                         </div>
                       </CardHeader>
                       <CardContent>
                         <div className="space-y-2">
                             <div className="flex justify-between items-center">
                               <span className="text-sm">Current Stock:</span>
                               <div className="font-medium text-destructive text-right">
                                 <span>{product.current_stock || 0} {product.uom_purchase || 'units'}</span>
                               </div>
                             </div>
                           <div className="flex justify-between items-center">
                             <span className="text-sm">Reorder Point:</span>
                             <span className="font-medium">
                               {product.reorder_point || 0} {product.size_unit || 'units'}
                             </span>
                           </div>
                           {product.cost_per_unit && (
                             <div className="flex justify-between items-center">
                               <span className="text-sm">Unit Cost:</span>
                               <span className="font-medium">${product.cost_per_unit}</span>
                             </div>
                           )}
                           {inventoryMetrics.productMetrics[product.id] && (
                             <>
                               <div className="flex justify-between items-center">
                                 <span className="text-sm">Inventory Cost:</span>
                                 <span className="font-medium text-orange-600">
                                   ${inventoryMetrics.productMetrics[product.id].inventoryCost.toFixed(2)}
                                 </span>
                               </div>
                                <div className="flex justify-between items-center">
                                  <span className="text-sm">Inventory Value:</span>
                                  <span className="font-medium text-green-600">
                                    ${inventoryMetrics.productMetrics[product.id].inventoryValue.toFixed(2)}
                                  </span>
                                </div>
                                <div className="mt-2">
                                  <InventoryValueBadge
                                    calculationMethod={inventoryMetrics.productMetrics[product.id].calculationMethod}
                                    markupUsed={inventoryMetrics.productMetrics[product.id].markupUsed}
                                    category={product.category}
                                  />
                                </div>
                             </>
                           )}
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

          <TabsContent value="reconciliation" className="mt-6">
            {selectedRestaurant && (
              <>
                {reconciliationView === 'history' && !activeSession && (
                  <ReconciliationHistory
                    restaurantId={selectedRestaurant.restaurant_id}
                    onStartNew={async () => {
                      await startReconciliation();
                      setReconciliationView('session');
                    }}
                  />
                )}
                {(reconciliationView === 'session' || activeSession) && (
                  <ReconciliationSession
                    restaurantId={selectedRestaurant.restaurant_id}
                    onComplete={() => setReconciliationView('summary')}
                  />
                )}
                {reconciliationView === 'summary' && (
                  <ReconciliationSummary
                    restaurantId={selectedRestaurant.restaurant_id}
                    onBack={() => setReconciliationView('session')}
                    onComplete={() => {
                      setReconciliationView('history');
                      refetchProducts();
                    }}
                  />
                )}
              </>
            )}
          </TabsContent>

          <TabsContent value="categories" className="mt-6">
            {selectedRestaurant && (
              <InventorySettings restaurantId={selectedRestaurant.restaurant_id} />
            )}
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

      {/* Waste Dialog */}
      {showWasteDialog && wasteProduct && selectedRestaurant && (
        <WasteDialog
          open={showWasteDialog}
          onOpenChange={setShowWasteDialog}
          product={wasteProduct}
          restaurantId={selectedRestaurant.restaurant_id}
          onWasteReported={() => {
            window.location.reload();
          }}
        />
      )}

      {/* Transfer Dialog */}
      {showTransferDialog && transferProduct && selectedRestaurant && (
        <TransferDialog
          open={showTransferDialog}
          onOpenChange={setShowTransferDialog}
          product={transferProduct}
          restaurantId={selectedRestaurant.restaurant_id}
          onTransferCompleted={() => {
            window.location.reload();
          }}
        />
      )}

      {/* Quick Inventory Dialog */}
      {quickInventoryProduct && (
        <QuickInventoryDialog
          open={showQuickInventoryDialog}
          onOpenChange={setShowQuickInventoryDialog}
          product={quickInventoryProduct}
          mode={scanMode}
          onSave={handleQuickInventorySave}
        />
      )}
    </div>
  );
};