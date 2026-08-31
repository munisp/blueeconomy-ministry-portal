// EChart is a minimal React binding over Apache ECharts (Apache-2.0),
// tree-shaken to the bar/line charts and canvas renderer the statistics
// dashboard uses. The wrapper owns the chart instance lifecycle: init on
// mount, setOption on data change, resize with the container, dispose on
// unmount. All option content is built by the dashboard from observed API
// rows; the wrapper itself holds no data.
import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, LineChart } from "echarts/charts";
import { GridComponent, LegendComponent, TitleComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { EChartsCoreOption } from "echarts/core";

echarts.use([BarChart, LineChart, GridComponent, LegendComponent, TitleComponent, TooltipComponent, CanvasRenderer]);

export interface EChartProperties {
  option: EChartsCoreOption;
  height?: number;
  ariaLabel: string;
}

export function EChart({ option, height = 320, ariaLabel }: EChartProperties) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }
    const chart = echarts.init(container);
    chartRef.current = chart;
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(container);
    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(option, { notMerge: true });
  }, [option]);

  return <div ref={containerRef} role="img" aria-label={ariaLabel} style={{ width: "100%", height: `${height}px` }} />;
}
