import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Plus, Search, Package, AlertTriangle, Edit, Trash2, ArrowRightLeft, Trash, Download, X, ArrowUpDown, FileSpreadsheet, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Skeleton } from '@/components/ui/skeleton';
import { MetricIcon } from '@/components/MetricIcon';
import { PageHeader } from '@/components/PageHeader';
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
import { ProductRecipeUsage } from '@/components/ProductRecipeUsage';
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
import { useInventoryAlerts } from '@/hooks/useInventoryAlerts';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { productLookupService, ProductLookupResult } from '@/services/productLookupService';
import { ProductEnhancementService } from '@/services/productEnhancementService';
import { ocrService } from '@/services/ocrService';
import { cn } from '@/lib/utils';
import { formatInventoryLevel } from '@/lib/inventoryDisplay';
import { exportToCSV, generateCSVFilename } from '@/utils/csvExport';
import { generateTablePDF } from '@/utils/pdfExport';

export const Inventory: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const { selectedRestaurant, setSelectedRestaurant, restaurants, loading: restaurantsLoading, createRestaurant } = useRestaurantContext();
  const { toast } = useToast();
  
  const { products, loading, createProduct, updateProductWithQuantity, deleteProduct, findProductByGtin, refetchProducts } = useProducts(selectedRestaurant?.restaurant_id || null);
  const { updateProductStockWithAudit } = useInventoryAudit();
  const inventoryMetrics = useInventoryMetrics(selectedRestaurant?.restaurant_id || null, products);
  const { lowStockItems: lowStockProducts, exportLowStockCSV } = useInventoryAlerts(selectedRestaurant?.restaurant_id || null);
  
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
  
  // Filter and sorting state
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [stockStatusFilter, setStockStatusFilter] = useState('all');
  const [sortBy, setSortBy] = useState<'name' | 'stock' | 'cost' | 'inventoryCost' | 'inventoryValue' | 'category' | 'updated'>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [isExporting, setIsExporting] = useState(false);
  
  // Check for ?create=true query parameter to open product dialog from recipes
  useEffect(() => {
    if (searchParams.get('create') === 'true') {
      setShowProductDialog(true);
      // Remove the query parameter
      searchParams.delete('create');
      setSearchParams(searchParams);
    }
  }, [searchParams, setSearchParams]);

  // Handler to close quick inventory dialog and clear product state
  const handleCloseQuickInventoryDialog = (open: boolean) => {
    setShowQuickInventoryDialog(open);
    if (!open) {
      setQuickInventoryProduct(null);
    }
  };
  const [reconciliationView, setReconciliationView] = useState<'history' | 'session' | 'summary'>('history');
  const { activeSession, startReconciliation, refreshSession } = useReconciliation(selectedRestaurant?.restaurant_id || null);

  // Check if user has permission to delete products
  const canDeleteProducts = selectedRestaurant?.role === 'owner' || selectedRestaurant?.role === 'manager';
  
  // Get unique categories from products
  const categories = useMemo(() => 
    ['all', ...new Set(products.map(p => p.category).filter(Boolean))].sort(),
    [products]
  );
  
  // Calculate active filters count
  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (searchTerm) count++;
    if (categoryFilter !== 'all') count++;
    if (stockStatusFilter !== 'all') count++;
    if (sortBy !== 'name') count++;
    if (sortDirection !== 'asc') count++;
    return count;
  }, [searchTerm, categoryFilter, stockStatusFilter, sortBy, sortDirection]);
  
  // Clear all filters
  const clearFilters = () => {
    setSearchTerm('');
    setCategoryFilter('all');
    setStockStatusFilter('all');
    setSortBy('name');
    setSortDirection('asc');
  };

  // Memoize filtered and sorted products for performance
  const filteredProducts = useMemo(() => {
    let filtered = products;
    
    // Text search
    if (searchTerm) {
      filtered = filtered.filter(product =>
        product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        product.sku.toLowerCase().includes(searchTerm.toLowerCase()) ||
        product.brand?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        product.category?.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    
    // Category filter
    if (categoryFilter !== 'all') {
      filtered = filtered.filter(product => product.category === categoryFilter);
    }
    
    // Stock status filter
    if (stockStatusFilter !== 'all') {
      filtered = filtered.filter(product => {
        const stock = product.current_stock || 0;
        const reorder = product.reorder_point || 0;
        const parMax = product.par_level_max || 0;
        
        switch (stockStatusFilter) {
          case 'in-stock':
            return stock > reorder;
          case 'low-stock':
            return stock > 0 && stock <= reorder;
          case 'out-of-stock':
            return stock === 0;
          case 'overstock':
            return parMax > 0 && stock > parMax;
          default:
            return true;
        }
      });
    }
    
    // Sorting
    filtered.sort((a, b) => {
      let comparison = 0;
      
      switch (sortBy) {
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'stock':
          comparison = (a.current_stock || 0) - (b.current_stock || 0);
          break;
        case 'cost':
          comparison = (a.cost_per_unit || 0) - (b.cost_per_unit || 0);
          break;
        case 'inventoryCost':
          const aCost = inventoryMetrics.productMetrics[a.id]?.inventoryCost || 0;
          const bCost = inventoryMetrics.productMetrics[b.id]?.inventoryCost || 0;
          comparison = aCost - bCost;
          break;
        case 'inventoryValue':
          const aValue = inventoryMetrics.productMetrics[a.id]?.inventoryValue || 0;
          const bValue = inventoryMetrics.productMetrics[b.id]?.inventoryValue || 0;
          comparison = aValue - bValue;
          break;
        case 'category':
          comparison = (a.category || '').localeCompare(b.category || '');
          if (comparison === 0) {
            comparison = a.name.localeCompare(b.name);
          }
          break;
        case 'updated':
          comparison = new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
          break;
      }
      
      return sortDirection === 'asc' ? comparison : -comparison;
    });
    
    return filtered;
  }, [products, searchTerm, categoryFilter, stockStatusFilter, sortBy, sortDirection, inventoryMetrics]);

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
    
    // Check if product already exists in inventory (search by original barcode)
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
    const filePath = `${selectedRestaurant?.restaurant_id}/${fileName}`;

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
      
      // Check if we came from the recipe dialog
      const recipeStateJson = sessionStorage.getItem('recipeFormState');
      if (recipeStateJson) {
        try {
          const recipeState = JSON.parse(recipeStateJson);
          sessionStorage.removeItem('recipeFormState');
          
          // Navigate back to recipes with the new product ID
          navigate(`/recipes?newProductId=${newProduct.id}&returnToRecipe=true`);
          
          toast({
            title: "Product created",
            description: "Returning to recipe editor with your new product",
          });
        } catch (error) {
          console.error('Error parsing recipe state:', error);
        }
      }
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
        // Audit log is already created by createProduct hook via logPurchase
        // No need for duplicate logging here
      toast({
        title: "Product created",
        description: `${newProduct.name} added to inventory${quantityToAdd > 0 ? ` with ${quantityToAdd.toFixed(2)} units` : ''}`,
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
            description: `${isAdjustment ? 'Adjustment' : 'Addition'}: ${quantityDifference >= 0 ? '+' : ''}${quantityDifference.toFixed(2)} units. New total: ${finalStock.toFixed(2)}`,
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
          ? `Added ${quantity.toFixed(2)} to ${quickInventoryProduct.name}`
          : `Set ${quickInventoryProduct.name} to ${quantity.toFixed(2)}`,
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
      {/* Enhanced Header */}
      <div className="max-w-7xl mx-auto p-4">
        <div className="flex items-center justify-between mb-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/')}
            className="p-2 md:px-3 hover:bg-primary/10 transition-all duration-300"
            aria-label="Return to dashboard"
          >
            <ArrowLeft className="h-4 w-4 md:mr-2" />
            <span className="hidden md:inline">Dashboard</span>
          </Button>
          <div className="flex gap-2">
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => navigate('/receipt-import')}
              className="p-2 md:px-3 border-primary/20 hover:border-primary/40 hover:bg-primary/5 transition-all duration-300"
              aria-label="Upload receipt for inventory"
            >
              <Package className="h-4 w-4 md:mr-2" />
              <span className="hidden md:inline">Upload Receipt</span>
            </Button>
            <Button 
              onClick={handleCreateManually} 
              size="sm"
              className="bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 shadow-lg shadow-emerald-500/30 transition-all duration-300 hover:scale-[1.02]"
              aria-label="Add new product manually"
            >
              <Plus className="h-4 w-4 md:mr-2" />
              <span className="hidden sm:inline">Add Product</span>
            </Button>
          </div>
        </div>
        
        <PageHeader
          icon={Package}
          iconVariant="emerald"
          title="Inventory Management"
          restaurantName={selectedRestaurant?.restaurant?.name}
        />
      </div>

      <div className="max-w-7xl mx-auto p-4 md:p-6">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-2 md:grid-cols-5 h-auto" role="tablist">
            <TabsTrigger value="scanner" className="flex-col py-2 px-1" aria-label="Scanner tab">
              <span className="text-xs md:text-sm">Scanner</span>
              <span className="text-lg" aria-hidden="true">{currentMode === 'scanner' ? '📱' : '📸'}</span>
            </TabsTrigger>
            <TabsTrigger value="products" className="flex-col py-2 px-1" aria-label={`Products tab, ${products.length} items`}>
              <span className="text-xs md:text-sm">Products</span>
              <span className="text-xs">({products.length})</span>
            </TabsTrigger>
            <TabsTrigger value="low-stock" className="flex-col py-2 px-1" aria-label={`Low stock tab${lowStockProducts.length > 0 ? `, ${lowStockProducts.length} alerts` : ''}`}>
              <span className="text-xs md:text-sm">Low Stock</span>
              {lowStockProducts.length > 0 && (
                <Badge variant="destructive" className="text-xs h-4 px-1">
                  {lowStockProducts.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="reconciliation" className="flex-col py-2 px-1" aria-label={`Reconciliation tab${activeSession ? ', session active' : ''}`}>
              <span className="text-xs md:text-sm">Reconcile</span>
              {activeSession && (
                <Badge className="text-xs h-4 px-1 bg-blue-500">Active</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="categories" className="flex-col py-2 px-1" aria-label="Settings tab">
              <span className="text-xs md:text-sm">Settings</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="scanner" className="mt-4 md:mt-6">
            <div className="space-y-4 md:space-y-6">
              {/* Enhanced Scan Mode Toggle - Add vs Reconcile */}
              <Card className="border-2 border-transparent bg-gradient-to-br from-background via-background to-primary/5 max-w-md mx-auto">
                <CardContent className="pt-4">
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => setScanMode('add')}
                      className={cn(
                        'group relative overflow-hidden rounded-xl p-4 transition-all duration-300',
                        'border-2 hover:scale-[1.02] hover:shadow-lg',
                        scanMode === 'add'
                          ? 'border-emerald-500 bg-gradient-to-br from-emerald-500/20 to-green-500/20 shadow-lg shadow-emerald-500/20'
                          : 'border-border bg-card hover:border-emerald-500/50'
                      )}
                    >
                      <div className="flex flex-col items-center gap-2">
                        <div className={cn(
                          'rounded-lg p-2 transition-all duration-300',
                          scanMode === 'add'
                            ? 'bg-gradient-to-br from-emerald-500 to-green-500 shadow-lg shadow-emerald-500/30'
                            : 'bg-muted group-hover:bg-gradient-to-br group-hover:from-emerald-500/20 group-hover:to-green-500/20'
                        )}>
                          <Plus className={cn('h-5 w-5 transition-colors', scanMode === 'add' ? 'text-white' : 'text-foreground')} />
                        </div>
                        <span className={cn(
                          'text-sm font-medium transition-colors',
                          scanMode === 'add' ? 'text-emerald-700 dark:text-emerald-300' : 'text-muted-foreground'
                        )}>
                          Add Stock
                        </span>
                      </div>
                    </button>
                    <button
                      onClick={() => setScanMode('reconcile')}
                      className={cn(
                        'group relative overflow-hidden rounded-xl p-4 transition-all duration-300',
                        'border-2 hover:scale-[1.02] hover:shadow-lg',
                        scanMode === 'reconcile'
                          ? 'border-blue-500 bg-gradient-to-br from-blue-500/20 to-cyan-500/20 shadow-lg shadow-blue-500/20'
                          : 'border-border bg-card hover:border-blue-500/50'
                      )}
                    >
                      <div className="flex flex-col items-center gap-2">
                        <div className={cn(
                          'rounded-lg p-2 transition-all duration-300',
                          scanMode === 'reconcile'
                            ? 'bg-gradient-to-br from-blue-500 to-cyan-500 shadow-lg shadow-blue-500/30'
                            : 'bg-muted group-hover:bg-gradient-to-br group-hover:from-blue-500/20 group-hover:to-cyan-500/20'
                        )}>
                          <Package className={cn('h-5 w-5 transition-colors', scanMode === 'reconcile' ? 'text-white' : 'text-foreground')} />
                        </div>
                        <span className={cn(
                          'text-sm font-medium transition-colors',
                          scanMode === 'reconcile' ? 'text-blue-700 dark:text-blue-300' : 'text-muted-foreground'
                        )}>
                          Reconcile
                        </span>
                      </div>
                    </button>
                  </div>
                </CardContent>
              </Card>

              {/* Scanner/Image Mode Toggle */}
              <div className="flex justify-center">
                <div className="bg-muted p-1 rounded-lg w-full max-w-md">
                  <div className="grid grid-cols-2 gap-1">
                    <Button
                      variant={currentMode === 'scanner' ? 'default' : 'ghost'}
                      size="sm"
                      onClick={() => setCurrentMode('scanner')}
                      className="flex-1"
                      aria-label="Switch to scanner mode"
                      aria-pressed={currentMode === 'scanner'}
                    >
                      📱 Scanner
                    </Button>
                    <Button
                      variant={currentMode === 'image' ? 'default' : 'ghost'}
                      size="sm"
                      onClick={() => setCurrentMode('image')}
                      className="flex-1"
                      aria-label="Switch to image mode"
                      aria-pressed={currentMode === 'image'}
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
                      <div className="space-y-3" role="status" aria-live="polite">
                        <Skeleton className="h-8 w-8 rounded-full mx-auto" />
                        <Skeleton className="h-4 w-48 mx-auto" />
                      </div>
                      <p className="text-muted-foreground mt-4">Looking up product...</p>
                    </CardContent>
                  </Card>
                </div>
              )}
              
              {(isLookingUp && currentMode === 'image') && (
                <div className="flex justify-center">
                  <Card className="w-full max-w-md">
                    <CardContent className="py-8 text-center">
                      <div className="space-y-3" role="status" aria-live="polite">
                        <Skeleton className="h-8 w-8 rounded-full mx-auto" />
                        <Skeleton className="h-4 w-48 mx-auto" />
                      </div>
                      <p className="text-muted-foreground mt-4">Analyzing image...</p>
                    </CardContent>
                  </Card>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="products" className="mt-6">
            <div className="space-y-6">
              {/* Inventory Summary Cards with Gradients */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card className="border-2 border-transparent bg-gradient-to-br from-orange-500/10 via-background to-orange-600/5 hover:shadow-lg transition-all duration-300 hover:scale-[1.01]">
                  <CardHeader className="pb-3">
                    <div className="flex items-center gap-3">
                      <MetricIcon icon={Package} variant="amber" />
                      <div>
                        <CardTitle className="text-lg bg-gradient-to-r from-orange-600 to-orange-700 bg-clip-text text-transparent">
                          Total Inventory Cost
                        </CardTitle>
                        <CardDescription>Total value of all stock at cost price</CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {inventoryMetrics.loading ? (
                      <div className="space-y-2">
                        <Skeleton className="h-10 w-32" />
                      </div>
                    ) : (
                      <div className="text-3xl font-bold bg-gradient-to-r from-orange-600 to-orange-700 bg-clip-text text-transparent">
                        ${inventoryMetrics.totalInventoryCost.toFixed(2)}
                      </div>
                    )}
                  </CardContent>
                </Card>
                <Card className="border-2 border-transparent bg-gradient-to-br from-emerald-500/10 via-background to-green-600/5 hover:shadow-lg transition-all duration-300 hover:scale-[1.01]">
                  <CardHeader className="pb-3">
                    <div className="flex items-center gap-3">
                      <MetricIcon icon={Package} variant="emerald" />
                      <div>
                        <CardTitle className="text-lg bg-gradient-to-r from-emerald-600 to-green-700 bg-clip-text text-transparent">
                          Total Inventory Value
                        </CardTitle>
                        <CardDescription>Potential revenue from all stock</CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {inventoryMetrics.loading ? (
                      <div className="space-y-2">
                        <Skeleton className="h-10 w-32" />
                        <Skeleton className="h-4 w-48" />
                        <Skeleton className="h-4 w-48" />
                      </div>
                    ) : (
                      <>
                        <div className="text-3xl font-bold bg-gradient-to-r from-emerald-600 to-green-700 bg-clip-text text-transparent">
                          ${inventoryMetrics.totalInventoryValue.toFixed(2)}
                        </div>
                        <div className="mt-3 space-y-1 text-sm text-muted-foreground">
                          <div className="flex justify-between">
                            <span>Recipe-based:</span>
                            <span className="font-medium">{inventoryMetrics.calculationSummary.recipeBasedCount} products</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Estimated:</span>
                            <span className="font-medium">{inventoryMetrics.calculationSummary.estimatedCount} products</span>
                          </div>
                          {inventoryMetrics.calculationSummary.mixedCount > 0 && (
                            <div className="flex justify-between">
                              <span>Mixed:</span>
                              <span className="font-medium">{inventoryMetrics.calculationSummary.mixedCount} products</span>
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Filters & Sorting Card */}
              <Card>
                <CardHeader className="pb-4">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">Filters & Sorting</CardTitle>
                    <div className="flex items-center gap-2">
                      {activeFiltersCount > 0 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={clearFilters}
                          className="h-8 px-2 text-xs"
                        >
                          <X className="h-3 w-3 mr-1" />
                          Clear {activeFiltersCount} filter{activeFiltersCount > 1 ? 's' : ''}
                        </Button>
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" size="sm" disabled={isExporting || filteredProducts.length === 0}>
                            {isExporting ? (
                              <>
                                <Download className="mr-2 h-4 w-4 animate-pulse" />
                                Exporting...
                              </>
                            ) : (
                              <>
                                <Download className="mr-2 h-4 w-4" />
                                Export
                              </>
                            )}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="bg-background z-50">
                          <DropdownMenuItem 
                            onClick={async () => {
                              setIsExporting(true);
                              try {
                                const csvData = filteredProducts.map(p => ({
                                  Name: p.name,
                                  SKU: p.sku,
                                  Brand: p.brand || '',
                                  Category: p.category || '',
                                  'Current Stock': p.current_stock || 0,
                                  'Unit Cost': p.cost_per_unit ? `$${p.cost_per_unit.toFixed(2)}` : '',
                                  'Inventory Cost': inventoryMetrics.productMetrics[p.id]?.inventoryCost.toFixed(2) || '0.00',
                                  'Inventory Value': inventoryMetrics.productMetrics[p.id]?.inventoryValue.toFixed(2) || '0.00',
                                  Status: (p.current_stock || 0) === 0 ? 'Out of Stock' : 
                                          (p.current_stock || 0) <= (p.reorder_point || 0) ? 'Low Stock' : 
                                          (p.par_level_max && (p.current_stock || 0) > p.par_level_max) ? 'Overstock' : 'In Stock'
                                }));
                                
                                exportToCSV({
                                  data: csvData,
                                  filename: generateCSVFilename('inventory_products'),
                                });
                                
                                toast({
                                  title: "Export Complete",
                                  description: `Exported ${filteredProducts.length} products to CSV`,
                                });
                              } catch (error) {
                                if (import.meta?.env?.DEV) console.error("Error exporting CSV:", error);
                                toast({
                                  title: "Export Failed",
                                  description: "Failed to export products",
                                  variant: "destructive",
                                });
                              } finally {
                                setIsExporting(false);
                              }
                            }}
                            className="cursor-pointer"
                            disabled={isExporting}
                          >
                            <FileSpreadsheet className="mr-2 h-4 w-4" />
                            Export as CSV
                          </DropdownMenuItem>
                          <DropdownMenuItem 
                            onClick={async () => {
                              setIsExporting(true);
                              try {
                                const columns = ["Name", "SKU", "Category", "Stock", "Unit Cost", "Inventory Cost", "Status"];
                                const rows = filteredProducts.map(p => [
                                  p.name,
                                  p.sku,
                                  p.category || '',
                                  `${(p.current_stock || 0).toFixed(2)} ${p.uom_purchase || 'units'}`,
                                  p.cost_per_unit ? `$${p.cost_per_unit.toFixed(2)}` : '',
                                  `$${(inventoryMetrics.productMetrics[p.id]?.inventoryCost || 0).toFixed(2)}`,
                                  (p.current_stock || 0) === 0 ? 'Out of Stock' : 
                                  (p.current_stock || 0) <= (p.reorder_point || 0) ? 'Low Stock' : 
                                  (p.par_level_max && (p.current_stock || 0) > p.par_level_max) ? 'Overstock' : 'In Stock'
                                ]);
                                
                                generateTablePDF({
                                  title: "Inventory Products Report",
                                  restaurantName: selectedRestaurant?.restaurant.name || "",
                                  columns,
                                  rows,
                                  filename: generateCSVFilename('inventory_products').replace('.csv', '.pdf'),
                                });
                                
                                toast({
                                  title: "Export Complete",
                                  description: `Exported ${filteredProducts.length} products to PDF`,
                                });
                              } catch (error) {
                                if (import.meta?.env?.DEV) console.error("Error exporting PDF:", error);
                                toast({
                                  title: "Export Failed",
                                  description: "Failed to export products",
                                  variant: "destructive",
                                });
                              } finally {
                                setIsExporting(false);
                              }
                            }}
                            className="cursor-pointer"
                            disabled={isExporting}
                          >
                            <FileText className="mr-2 h-4 w-4" />
                            Export as PDF
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                    {/* Search */}
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Search</label>
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          placeholder="Name, SKU, brand..."
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          className="pl-10"
                          aria-label="Search products by name, SKU, brand, or category"
                        />
                      </div>
                    </div>
                    
                    {/* Category Filter */}
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Category</label>
                      <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                        <SelectTrigger aria-label="Filter by category">
                          <SelectValue placeholder="All Categories" />
                        </SelectTrigger>
                        <SelectContent className="bg-background z-50">
                          <SelectItem value="all">📁 All Categories</SelectItem>
                          {categories.filter(c => c !== 'all').map(category => (
                            <SelectItem key={category} value={category}>
                              {category}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    
                    {/* Stock Status Filter */}
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Stock Status</label>
                      <Select value={stockStatusFilter} onValueChange={setStockStatusFilter}>
                        <SelectTrigger aria-label="Filter by stock status">
                          <SelectValue placeholder="All Products" />
                        </SelectTrigger>
                        <SelectContent className="bg-background z-50">
                          <SelectItem value="all">⚪ All Products</SelectItem>
                          <SelectItem value="in-stock">🟢 In Stock</SelectItem>
                          <SelectItem value="low-stock">🟡 Low Stock</SelectItem>
                          <SelectItem value="out-of-stock">🔴 Out of Stock</SelectItem>
                          <SelectItem value="overstock">🔵 Overstock</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    
                    {/* Sort By */}
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Sort By</label>
                      <Select value={sortBy} onValueChange={(value: any) => setSortBy(value)}>
                        <SelectTrigger aria-label="Sort products by">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-background z-50">
                          <SelectItem value="name">📝 Name (A-Z)</SelectItem>
                          <SelectItem value="stock">📦 Stock Level</SelectItem>
                          <SelectItem value="cost">💰 Unit Cost</SelectItem>
                          <SelectItem value="inventoryCost">🏷️ Inventory Cost</SelectItem>
                          <SelectItem value="inventoryValue">💎 Inventory Value</SelectItem>
                          <SelectItem value="category">📊 Category</SelectItem>
                          <SelectItem value="updated">📅 Last Updated</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    
                    {/* Sort Direction */}
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Direction</label>
                      <Button
                        variant="outline"
                        onClick={() => setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')}
                        className="w-full transition-all hover:scale-105 duration-200"
                        aria-label={sortDirection === 'asc' ? 'Ascending order' : 'Descending order'}
                        title={sortDirection === 'asc' ? 'Ascending order' : 'Descending order'}
                      >
                        <ArrowUpDown 
                          className={cn(
                            "h-4 w-4 mr-2 transition-transform duration-200",
                            sortDirection === 'desc' && "rotate-180"
                          )} 
                        />
                        {sortDirection === 'asc' ? 'Ascending' : 'Descending'}
                      </Button>
                    </div>
                  </div>
                  
                  {/* Results Count */}
                  <div className="mt-4 text-sm text-muted-foreground" role="status" aria-live="polite">
                    Showing {filteredProducts.length} of {products.length} products
                  </div>
                </CardContent>
              </Card>

              {loading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" role="status" aria-live="polite">
                  {[...Array(6)].map((_, i) => (
                    <Card key={i}>
                      <CardHeader>
                        <Skeleton className="h-6 w-3/4 mb-2" />
                        <Skeleton className="h-4 w-1/2" />
                      </CardHeader>
                      <CardContent className="space-y-2">
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="h-4 w-2/3" />
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : filteredProducts.length === 0 ? (
                <div className="text-center py-8">
                  <Package className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">
                    {activeFiltersCount > 0 
                      ? 'No products found matching your filters.' 
                      : searchTerm 
                      ? 'No products found matching your search.' 
                      : 'No products in inventory yet.'}
                  </p>
                  {activeFiltersCount > 0 ? (
                    <Button 
                      className="mt-4" 
                      variant="outline"
                      onClick={clearFilters}
                    >
                      Clear Filters
                    </Button>
                  ) : (
                    <Button 
                      className="mt-4" 
                      onClick={() => setShowProductDialog(true)}
                    >
                      Add Your First Product
                    </Button>
                  )}
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
                                   <TooltipProvider>
                                     <Tooltip>
                                       <TooltipTrigger asChild>
                                         <CardTitle className="text-lg line-clamp-2 cursor-help leading-snug">
                                           {product.name}
                                         </CardTitle>
                                       </TooltipTrigger>
                                       <TooltipContent className="max-w-md">
                                         <p>{product.name}</p>
                                       </TooltipContent>
                                     </Tooltip>
                                   </TooltipProvider>
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
                            <div className="flex flex-wrap gap-2">
                              {product.category && (
                                <Badge variant="secondary">{product.category}</Badge>
                              )}
                            </div>
                            <div className="flex justify-between items-center">
                               <span className="text-sm">Stock:</span>
                               <div className={`font-medium text-right ${
                                 (product.current_stock || 0) <= (product.reorder_point || 0) 
                                   ? 'text-destructive' 
                                   : 'text-foreground'
                               }`}>
                                 <span>{Number(product.current_stock || 0).toFixed(2)} {product.uom_purchase || 'units'}</span>
                               </div>
                             </div>
                           {product.cost_per_unit && (
                             <div className="flex justify-between items-center">
                               <span className="text-sm">Unit Cost:</span>
                               <span className="font-medium">${Number(product.cost_per_unit).toFixed(2)}</span>
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
                            
                            {/* Recipe Usage with Conversion Warnings */}
                            <ProductRecipeUsage 
                              productId={product.id}
                              restaurantId={selectedRestaurant.restaurant_id}
                              products={products}
                            />
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
                <Card className="border-2 border-transparent bg-gradient-to-br from-red-500/10 via-background to-orange-500/5">
                <CardContent className="py-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <MetricIcon icon={AlertTriangle} variant="red" className="animate-pulse" />
                      <div>
                        <h2 className="text-xl font-bold bg-gradient-to-r from-red-600 to-orange-600 bg-clip-text text-transparent">
                          Low Stock Alert
                        </h2>
                        <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
                          {lowStockProducts.length} {lowStockProducts.length === 1 ? 'item needs' : 'items need'} attention
                        </p>
                      </div>
                    </div>
                    {lowStockProducts.length > 0 && (
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={exportLowStockCSV}
                        className="border-red-500/30 text-red-600 hover:bg-red-500/10 hover:border-red-500 transition-all duration-300"
                        aria-label="Export low stock list to CSV"
                      >
                        <Download className="h-4 w-4 mr-2" />
                        Export List
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>

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
                                   <span>{formatInventoryLevel(product.current_stock || 0, product, { showBothUnits: false })}</span>
                                 </div>
                               </div>
                             <div className="flex justify-between items-center">
                               <span className="text-sm">Reorder Point:</span>
                               <span className="font-medium">
                                 {formatInventoryLevel(product.reorder_point || 0, product, { showBothUnits: false })}
                               </span>
                             </div>
                            {product.cost_per_unit && (
                              <div className="flex justify-between items-center">
                                <span className="text-sm">Unit Cost:</span>
                                <span className="font-medium">${Number(product.cost_per_unit).toFixed(2)}</span>
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
                    onCancel={() => {
                      setReconciliationView('history');
                      refreshSession();
                    }}
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
        restaurantId={selectedRestaurant?.restaurant_id || ''}
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
          onOpenChange={handleCloseQuickInventoryDialog}
          product={quickInventoryProduct}
          mode={scanMode}
          onSave={handleQuickInventorySave}
        />
      )}
    </div>
  );
};