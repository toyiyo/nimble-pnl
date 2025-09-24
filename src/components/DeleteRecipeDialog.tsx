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
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Recipe</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete "{recipe?.name}"? This action cannot be undone.
            {recipe?.pos_item_name && (
              <span className="block mt-2 font-medium">
                This recipe is currently mapped to POS item: {recipe.pos_item_name}
              </span>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={loading}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {loading ? 'Deleting...' : 'Delete Recipe'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}