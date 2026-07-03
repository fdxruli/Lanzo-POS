import useKitchenOrdersCloud from '../hooks/restaurant/useKitchenOrdersCloud';
import CloudKitchenMonitorRest8Container from '../components/restaurant/CloudKitchenMonitorRest8ContainerFixed';
import LocalKitchenMonitor from '../components/restaurant/LocalKitchenMonitor';
import './OrderPage.css';
import './OrderPageCloud.css';

export default function OrdersPage() {
  const kitchenCloud = useKitchenOrdersCloud();

  if (kitchenCloud.isCloudKdsEnabled) {
    return (
      <div className="kds-container mode-cloud">
        <CloudKitchenMonitorRest8Container kitchenCloud={kitchenCloud} />
      </div>
    );
  }

  return <LocalKitchenMonitor />;
}
