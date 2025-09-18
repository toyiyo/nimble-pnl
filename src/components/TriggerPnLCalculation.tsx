import { Button } from "./ui/button"
import { supabase } from "@/integrations/supabase/client"
import { useToast } from "@/hooks/use-toast"
import { useState } from "react"

interface TriggerPnLCalculationProps {
  restaurantId: string
  onCalculationComplete?: () => void
}

export const TriggerPnLCalculation = ({ restaurantId, onCalculationComplete }: TriggerPnLCalculationProps) => {
  const [isCalculating, setIsCalculating] = useState(false)
  const { toast } = useToast()

  const calculatePnL = async (date: string) => {
    try {
      setIsCalculating(true)
      
      const { data, error } = await supabase.functions.invoke('trigger-pnl-calculation', {
        body: {
          restaurant_id: restaurantId,
          date
        }
      })

      if (error) {
        throw error
      }

      toast({
        title: "P&L Calculation Complete",
        description: `Successfully calculated P&L for ${date}`,
      })

      onCalculationComplete?.()
    } catch (error) {
      console.error('P&L calculation error:', error)
      toast({
        title: "Calculation Failed",
        description: error instanceof Error ? error.message : "Failed to calculate P&L",
        variant: "destructive"
      })
    } finally {
      setIsCalculating(false)
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        Trigger P&L calculation for synced Square data:
      </p>
      <div className="flex gap-2">
        <Button
          onClick={() => calculatePnL('2025-09-18')}
          disabled={isCalculating}
          size="sm"
          variant="outline"
        >
          Calculate Sep 18
        </Button>
        <Button
          onClick={() => calculatePnL('2025-09-16')}
          disabled={isCalculating}
          size="sm"
          variant="outline"
        >
          Calculate Sep 16
        </Button>
      </div>
    </div>
  )
}