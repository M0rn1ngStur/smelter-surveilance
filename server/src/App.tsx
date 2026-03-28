import { View, useInputStreams, InputStream, Rescaler, type Transition } from '@swmansion/smelter';
import { useFocusedInputId } from './focusStore';

const TRANSITION: Transition = {
  durationMs: 700,
  easingFunction: { functionName: 'cubic_bezier', points: [0.25, 0.1, 0.25, 1] },
};

export default function App() {
  const inputs = useInputStreams();
  const focusedInputId = useFocusedInputId();

  const allInputs = Object.values(inputs).slice(0, 4);
  const count = allInputs.length;

  if (count === 0) {
    return <View style={{ backgroundColor: '#161127' }} />;
  }

  if (count === 1) {
    return (
      <View style={{ backgroundColor: '#161127' }}>
        <Rescaler
          style={{ width: 1920, height: 1080, rescaleMode: 'fit', verticalAlign: 'bottom', horizontalAlign: 'center' }}
          transition={TRANSITION}
        >
          <InputStream inputId={allInputs[0].inputId} />
        </Rescaler>
      </View>
    );
  }

  // Determine which camera is focused (main/bottom)
  const mainId = focusedInputId && allInputs.some(i => i.inputId === focusedInputId)
    ? focusedInputId
    : allInputs[0].inputId;

  // Build top grid order (non-focused cameras, preserving original order)
  const topCameras = allInputs.filter(i => i.inputId !== mainId);
  const topWidth = Math.floor(1920 / 3);

  return (
    <View style={{ backgroundColor: '#161127' }}>
      {allInputs.map((input) => {
        if (input.inputId === mainId) {
          return (
            <Rescaler
              key={input.inputId}
              style={{ width: 1920, height: 720, top: 360, left: 0, rescaleMode: 'fill' }}
              transition={TRANSITION}
            >
              <InputStream inputId={input.inputId} />
            </Rescaler>
          );
        }

        const topIndex = topCameras.indexOf(input);
        return (
          <Rescaler
            key={input.inputId}
            style={{ width: topWidth, height: 360, top: 0, left: topIndex * topWidth, rescaleMode: 'fill' }}
            transition={TRANSITION}
          >
            <InputStream inputId={input.inputId} />
          </Rescaler>
        );
      })}
    </View>
  );
}
