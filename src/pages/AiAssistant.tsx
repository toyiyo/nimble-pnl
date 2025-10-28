import { AiChat } from '@/components/AiChat';

const AiAssistant = () => {
  return (
    <div className="h-[100dvh] md:h-[calc(100vh-8rem)] flex flex-col overflow-hidden">
      <AiChat />
    </div>
  );
};

export default AiAssistant;
