import { useEffect, useState } from 'react';

interface CountingNumberProps {
  value: number;
  duration?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
}

export function CountingNumber({ 
  value, 
  duration = 1000, 
  decimals = 0, 
  prefix = '', 
  suffix = '',
  className = ''
}: CountingNumberProps) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const startTime = Date.now();
    const startValue = count;
    
    const animate = () => {
      const now = Date.now();
      const progress = Math.min((now - startTime) / duration, 1);
      
      // Ease out cubic function for smooth animation
      const easeOut = 1 - Math.pow(1 - progress, 3);
      const currentCount = startValue + (value - startValue) * easeOut;
      
      setCount(currentCount);
      
      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        setCount(value);
      }
    };
    
    requestAnimationFrame(animate);
  }, [value, duration]);

  return (
    <span className={className}>
      {prefix}
      {count.toFixed(decimals)}
      {suffix}
    </span>
  );
}
