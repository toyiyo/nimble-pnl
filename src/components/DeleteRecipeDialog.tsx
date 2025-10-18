import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useRecipes, Recipe } from '@/hooks/useRecipes';
import { AlertTriangle } from 'lucide-react';

interface DeleteRecipeDialogProps {
  isOpen: boolean;
  onClose: () => void;
  recipe: Recipe | null;
}

export function DeleteRecipeDialog({ isOpen, onClose, recipe }: DeleteRecipeDialogProps) {
  const { deleteRecipe } = useRecipes(recipe?.restaurant_id || null);
  const [loading, setLoading] = useState(false);

  const handleDelete = async () => {
    if (!recipe) return;

    setLoading(true);
    try {
      await deleteRecipe(recipe.id);
      onClose();
    } catch (error) {
      console.error('Error deleting recipe:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AlertDialog open={isOpen} onOpenChange={onClose}>
      <AlertDialogContent className="border-destructive/50">
        <AlertDialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-lg bg-destructive/10 animate-pulse">
              <AlertTriangle className="w-6 h-6 text-destructive" />
            </div>
            <AlertDialogTitle className="text-xl">Delete Recipe</AlertDialogTitle>
          </div>
          <AlertDialogDescription className="space-y-2 text-base">
            <p>Are you sure you want to delete <span className="font-semibold text-foreground">"{recipe?.name}"</span>?</p>
            <p className="text-destructive font-medium">This action cannot be undone.</p>
            {recipe?.pos_item_name && (
              <div className="mt-3 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                <p className="font-medium text-amber-700 dark:text-amber-400">
                  ⚠️ This recipe is currently mapped to POS item: <span className="font-semibold">{recipe.pos_item_name}</span>
                </p>
              </div>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading} className="hover:bg-accent">Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={loading}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-all hover:scale-105"
          >
            {loading ? 'Deleting...' : 'Delete Recipe'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}