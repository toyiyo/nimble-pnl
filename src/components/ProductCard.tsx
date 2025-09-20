import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Package, Plus, ExternalLink } from 'lucide-react';
import { ProductLookupResult } from '@/services/productLookupService';
import { CreateProductData } from '@/hooks/useProducts';

interface ProductCardProps {
  product?: ProductLookupResult | null;
  gtin: string;
  onAddToInventory: (productData: CreateProductData) => void;
  onCreateManually: () => void;
  restaurantId: string;
  isLoading?: boolean;
}

export const ProductCard: React.FC<ProductCardProps> = ({
  product,
  gtin,
  onAddToInventory,
  onCreateManually,
  restaurantId,
  isLoading = false
}) => {
  const handleAddToInventory = () => {
    if (!product) return;

    const productData: CreateProductData = {
      restaurant_id: restaurantId,
      gtin: product.gtin,
      sku: product.gtin, // Use GTIN as SKU if no specific SKU
      name: product.product_name,
      brand: product.brand,
      category: product.category,
      description: `${product.brand ? product.brand + ' ' : ''}${product.package_size ? product.package_size : ''}`.trim(),
      // Set reasonable defaults
      current_stock: 0,
      par_level_min: 1,
      par_level_max: 10,
      reorder_point: 2,
    };

    onAddToInventory(productData);
  };

  if (isLoading) {
    return (
      <Card className="w-full max-w-md mx-auto">
        <CardHeader className="text-center">
          <div className="animate-pulse">
            <div className="h-6 bg-muted rounded w-3/4 mx-auto mb-2"></div>
            <div className="h-4 bg-muted rounded w-1/2 mx-auto"></div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="animate-pulse">
            <div className="h-32 bg-muted rounded mb-4"></div>
            <div className="h-4 bg-muted rounded mb-2"></div>
            <div className="h-4 bg-muted rounded w-2/3"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!product) {
    return (
      <Card className="w-full max-w-md mx-auto border-dashed">
        <CardHeader className="text-center">
          <CardTitle className="flex items-center gap-2 justify-center text-muted-foreground">
            <Package className="h-5 w-5" />
            Product Not Found
          </CardTitle>
          <CardDescription>
            GTIN: {gtin}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-center">
          <p className="text-sm text-muted-foreground">
            This product wasn't found in our database. You can add it manually to your inventory.
          </p>
          <Button onClick={onCreateManually} className="w-full">
            <Plus className="h-4 w-4 mr-2" />
            Add Product Manually
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <CardTitle className="text-lg leading-tight">
              {product.product_name}
            </CardTitle>
            {product.brand && (
              <CardDescription className="mt-1">
                {product.brand}
              </CardDescription>
            )}
          </div>
          <Badge variant="secondary" className="ml-2">
            {product.source}
          </Badge>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {product.image_url && (
          <div className="aspect-square bg-muted rounded-lg overflow-hidden">
            <img
              src={product.image_url}
              alt={product.product_name}
              className="w-full h-full object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          </div>
        )}
        
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">GTIN:</span>
            <span className="font-mono">{product.gtin}</span>
          </div>
          
          {product.package_size && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Size:</span>
              <span>{product.package_size}</span>
            </div>
          )}
          
          {product.category && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Category:</span>
              <span>{product.category}</span>
            </div>
          )}
        </div>

        <div className="flex gap-2 pt-2">
          <Button onClick={handleAddToInventory} className="flex-1">
            <Plus className="h-4 w-4 mr-2" />
            Add to Inventory
          </Button>
          
          {product.source === 'openfoodfacts' && (
            <Button
              variant="outline"
              size="icon"
              onClick={() => window.open(`https://world.openfoodfacts.org/product/${product.gtin}`, '_blank')}
            >
              <ExternalLink className="h-4 w-4" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
};