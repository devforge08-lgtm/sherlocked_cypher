
import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import './App.css'

const money = (amount) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(Number(amount) || 0)


function AnimatedNumber({ value, duration = 800 }) {
  const [displayValue, setDisplayValue] = useState(0)

  useEffect(() => {
    const target = Number(value) || 0
    const startTime = Date.now()
    let frameId

    function updateNumber() {
      const progress = Math.min((Date.now() - startTime) / duration, 1)
      const easedProgress = 1 - Math.pow(1 - progress, 3)

      setDisplayValue(Math.round(target * easedProgress))

      if (progress < 1) {
        frameId = requestAnimationFrame(updateNumber)
      }
    }

    updateNumber()

    return () => cancelAnimationFrame(frameId)
  }, [value, duration])

  return <>{displayValue.toLocaleString('en-IN')}</>
}


function App() {
  const [session, setSession] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authMode, setAuthMode] = useState('login')
  const [authName, setAuthName] = useState('')
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authArea, setAuthArea] = useState('')
  const [authError, setAuthError] = useState('')
  const [authMessage, setAuthMessage] = useState('')
  const [authSubmitting, setAuthSubmitting] = useState(false)
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [products, setProducts] = useState([])
  const [customers, setCustomers] = useState([])
  const [customerSearch, setCustomerSearch] = useState('')
  const [productSearch, setProductSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [activePage, setActivePage] = useState('Orders')
  const [statusFilter, setStatusFilter] = useState('all')


async function fetchOrders() {
  const { data: sessionData } = await supabase.auth.getSession()

console.log(
  'Admin session user:',
  sessionData.session?.user?.id
)
  setLoading(true)
  setError('')

  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Could not load orders:', error)
    setError(error.message)
    setLoading(false)
    return
  }

  const formattedOrders = (data ?? []).map((order) => ({
    ...order,
    total: order.total_amount,
  }))
  console.log('Orders received by admin:', data?.length, data)
  setOrders(formattedOrders)
  setLoading(false)
}


async function fetchProducts() {
  const { data, error } = await supabase
    .from('products')
    .select('id, name, description, price, category, stock, is_active, image_url')
    .order('id', { ascending: false })

  if (error) {
    console.error('Could not load products:', error.message)
    return
  }

  setProducts(data ?? [])
}


async function fetchCustomers() {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, role, created_at')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Could not load customers:', error.message)
    return
  }

  setCustomers(data ?? [])
}


  useEffect(() => {
    let mounted = true

    async function loadSession() {
      const { data, error } = await supabase.auth.getSession()

      if (!mounted) return

      if (error) {
        setAuthError(error.message)
      } else {
        setSession(data.session)
        console.log(
  'Session loaded:',
  data.session ? 'Logged in' : 'Not logged in'
)
      }

      setAuthLoading(false)
    }

    loadSession()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
      setAuthLoading(false)
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  
  useEffect(() => {
    fetchOrders()

    const channel = supabase
      .channel('admin-orders-live')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'orders',
        },
        () => {
          fetchOrders()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])


  const pendingCount = orders.filter(
    (order) => order.status === 'placed'
  ).length

  const activeCount = orders.filter((order) =>
    ['confirmed', 'packing', 'out_for_delivery'].includes(order.status)
  ).length

  const deliveredCount = orders.filter(
    (order) => order.status === 'delivered'
  ).length


const totalProducts = products.length

const lowStockCount = products.filter(
  (product) =>
    Number(product.stock) > 0 &&
    Number(product.stock) <= 5
).length

const outOfStockCount = products.filter(
  (product) => Number(product.stock) <= 0
).length

const deliveredSales = orders
  .filter((order) => order.status === 'delivered')
  .reduce((total, order) => total + (Number(order.total) || 0), 0)


  const filteredOrders = orders.filter(
    (order) =>
      statusFilter === 'all' || order.status === statusFilter
  )


const filteredProducts = products.filter((product) => {
  const search = productSearch.toLowerCase().trim()

  const matchesSearch =
    product.name?.toLowerCase().includes(search) ||
    product.category?.toLowerCase().includes(search)

  const matchesCategory =
    categoryFilter === 'all' ||
    product.category === categoryFilter

  return matchesSearch && matchesCategory
})

const productCategories = [
  ...new Set(
    products
      .map((product) => product.category)
      .filter(Boolean)
  ),
]

const filteredCustomers = customers.filter((customer) => {
  const search = customerSearch.toLowerCase().trim()

  return (
    customer.full_name?.toLowerCase().includes(search) ||
    customer.role?.toLowerCase().includes(search) ||
    customer.id?.toLowerCase().includes(search)
  )
})




  const navItems = [
    { name: 'Overview', icon: '▦' },
    { name: 'Orders', icon: '▤' },
    { name: 'Products', icon: '◇' },
    { name: 'Customers', icon: '♙' },
    { name: 'Delivery', icon: '♧' },
  ]

  return (
    <div className="admin-layout">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">Q</div>
          <div>
            <h2>QuickCart</h2>
            <span>ADMIN PANEL</span>
          </div>
        </div>

        <div className="nav-label">WORKSPACE</div>

        <nav className="navigation">
          {navItems.map((item) => (
            <button
              key={item.name}
              className={`nav-item ${
                activePage === item.name ? 'active' : ''
              }`}
              

onClick={() => {
  setActivePage(item.name)

  if (item.name === 'Products' || item.name === 'Overview') {
  fetchProducts()
}

  if (item.name === 'Customers') {
    fetchCustomers()
  }
}}


            >
              <span className="nav-icon">{item.icon}</span>
              {item.name}
              {item.name === 'Orders' && pendingCount > 0 && (
                <span className="nav-count">{pendingCount}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="admin-avatar">A</div>
          <div>
            <strong>Administrator</strong>
            <span>QuickCart team</span>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <span className="breadcrumb">Workspace / </span>
            <strong>{activePage}</strong>
          </div>
          <div className="connection-status">
            <span className="status-dot" />
            Supabase connected
          </div>
        </header>

        <section className="page-content">
          <div className="page-heading">
            <div>
              <span className="eyebrow">QUICKCART MANAGEMENT</span>
              <h1>{activePage}</h1>
              <p>
                {activePage === 'Orders'
                  ? 'Track customer orders and monitor fulfilment.'
                  : `Your ${activePage.toLowerCase()} workspace.`}
              </p>
            </div>

            <button className="refresh-button" onClick={fetchOrders}>
              <span>↻</span> Refresh data
            </button>
          </div>

          {activePage === 'Overview' ? (
            <>
              
  <div className="stats-grid">
    <article className="stat-card">
      <div className="stat-top">
        <span>Total orders</span>
        <span className="stat-icon green">▤</span>
      </div>
      <h2><AnimatedNumber value={orders.length} /></h2>
      <p>All orders in the database</p>
    </article>

    <article className="stat-card">
      <div className="stat-top">
        <span>Delivered sales</span>
        <span className="stat-icon green">₹</span>
      </div>
      <h2>{money(deliveredSales)}</h2>
      <p>Value of delivered orders</p>
    </article>

    <article className="stat-card">
      <div className="stat-top">
        <span>Low-stock products</span>
        <span className="stat-icon orange">!</span>
      </div>
      <h2><AnimatedNumber value={lowStockCount} /></h2>
      <p>Products with 1–5 units</p>
    </article>

    <article className="stat-card">
      <div className="stat-top">
        <span>Out of stock</span>
        <span className="stat-icon blue">◇</span>
      </div>
      <h2><AnimatedNumber value={outOfStockCount} /></h2>
      <p>Products needing restock</p>
    </article>
  </div>

  <section className="orders-panel">
    <div className="panel-heading">
      <div>
        <h2>Order activity</h2>
        <p>A quick summary of your current fulfilment workload</p>
      </div>
      <button
        className="refresh-button"
        onClick={() => {
          fetchOrders()
          fetchProducts()
        }}
      >
        ↻ Refresh overview
      </button>
    </div>

    <div className="stats-grid">
      <article className="stat-card">
        <div className="stat-top">
          <span>Awaiting confirmation</span>
          <span className="stat-icon orange">◷</span>
        </div>
        <h2><AnimatedNumber value={pendingCount} /></h2>
        <p>Newly placed orders</p>
      </article>

      <article className="stat-card">
        <div className="stat-top">
          <span>In progress</span>
          <span className="stat-icon blue">↗</span>
        </div>
        <h2><AnimatedNumber value={activeCount} /></h2>
        <p>Confirmed, packing or out for delivery</p>
      </article>

      <article className="stat-card">
        <div className="stat-top">
          <span>Delivered</span>
          <span className="stat-icon green">✓</span>
        </div>
        <h2><AnimatedNumber value={deliveredCount} /></h2>
        <p>Successfully completed orders</p>
      </article>

      <article className="stat-card">
        <div className="stat-top">
          <span>Total products</span>
          <span className="stat-icon green">◇</span>
        </div>
        <h2><AnimatedNumber value={totalProducts} /></h2>
        <p>Products returned by the catalogue</p>
      </article>
    </div>

    <div className="panel-footer">
      <span>Inventory and order summaries</span>
      <span>Values reflect data currently loaded</span>
    </div>
  </section>

                        </>
          ) : activePage === 'Orders' ? (
            <>
              <div className="stats-grid">
                <article className="stat-card">
                  <div className="stat-top">
                    <span>Awaiting confirmation</span>
                    <span className="stat-icon orange">◷</span>
                  </div>
                  <h2><AnimatedNumber value={pendingCount} /></h2>
                  <p>Newly placed orders</p>
                </article>

                <article className="stat-card">
                  <div className="stat-top">
                    <span>In progress</span>
                    <span className="stat-icon blue">↗</span>
                  </div>
                  <h2><AnimatedNumber value={activeCount} /></h2>
                  <p>Orders being processed</p>
                </article>

                <article className="stat-card">
                  <div className="stat-top">
                    <span>Delivered</span>
                    <span className="stat-icon green">✓</span>
                  </div>
                  <h2><AnimatedNumber value={deliveredCount} /></h2>
                  <p>Completed orders</p>
                </article>

                <article className="stat-card">
                  <div className="stat-top">
                    <span>Total orders</span>
                    <span className="stat-icon green">▤</span>
                  </div>
                  <h2><AnimatedNumber value={orders.length} /></h2>
                  <p>All orders in the database</p>
                </article>
              </div>

              <section className="orders-panel">
                <div className="panel-heading">
                  <div>
                    <h2>All orders</h2>
                    <p>View and track QuickCart orders</p>
                  </div>

                  <button
                    className="refresh-button"
                    onClick={fetchOrders}
                  >
                    ↻ Refresh orders
                  </button>
                </div>

                <div className="product-toolbar">
                  <select
                    value={statusFilter}
                    onChange={(event) => setStatusFilter(event.target.value)}
                    aria-label="Filter orders by status"
                  >
                    <option value="all">All statuses</option>
                    <option value="placed">Placed</option>
                    <option value="confirmed">Confirmed</option>
                    <option value="packing">Packing</option>
                    <option value="out_for_delivery">Out for delivery</option>
                    <option value="delivered">Delivered</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>

                {error && <div className="empty-state">{error}</div>}

                {loading ? (
                  <div className="empty-state">
                    <p>Loading orders...</p>
                  </div>
                ) : filteredOrders.length === 0 ? (
                  <div className="empty-state">
                    <h3>No orders found</h3>
                    <p>Try another status filter or refresh the orders.</p>
                  </div>
                ) : (
                  <div className="table-wrapper">
                    <table>
                      <thead>
                        <tr>
                          <th>ORDER ID</th>
                          <th>DATE</th>
                          <th>DELIVERY ADDRESS</th>
                          <th>TOTAL</th>
                          <th>PAYMENT</th>
                          <th>STATUS</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredOrders.map((order) => (
                          <tr key={order.id}>
                            <td><code>{order.id}</code></td>
                            <td>
                              {order.created_at
                                ? new Date(order.created_at).toLocaleDateString('en-IN')
                                : '—'}
                            </td>
                            <td>{order.delivery_address || '—'}</td>
                            <td>{money(order.total)}</td>
                            <td>{order.payment_method || '—'}</td>
                            <td>
                              <span className={`status-badge status-${order.status}`}>
                                {(order.status || 'unknown').replaceAll('_', ' ')}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
             </> 
          
            
              ):activePage === 'Products' ? (
  <section className="orders-panel">
   
<div className="panel-heading">
  <div>
    <h2>Product catalogue</h2>
    <p>Products stored in your QuickCart database</p>
  </div>

  <div className="product-toolbar">
    <input
      type="text"
      placeholder="Search name or category..."
      value={productSearch}
      onChange={(event) => setProductSearch(event.target.value)}
    />

<select
  value={categoryFilter}
  onChange={(event) => setCategoryFilter(event.target.value)}
  aria-label="Filter products by category"
>
  <option value="all">All categories</option>
  {productCategories.map((category) => (
    <option key={category} value={category}>
      {category}
    </option>
  ))}
</select>

    <button
      className="refresh-button"
      onClick={fetchProducts}
    >
      ↻ Refresh products
    </button>
  </div>
</div>


    {filteredProducts.length === 0 ? (
      <div className="empty-state">
        <h3>No products to display</h3>
        <p>No products were returned. The table may be empty, or access may be restricted.</p>
      </div>
    ) : (
      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>PRODUCT</th>
              <th>CATEGORY</th>
              <th>PRICE</th>
              <th>STOCK</th>
              <th>STATUS</th>
            </tr>
          </thead>
          <tbody>
            {filteredProducts.map((product) => (
              <tr key={product.id}>
                <td>{product.id}</td>
                <td><strong>{product.name}</strong></td>
                <td>{product.category || '—'}</td>
                <td>{money(product.price)}</td>
                
<td>
  <span
    className={`status-badge ${
      Number(product.stock) <= 0
        ? 'stock-out'
        : Number(product.stock) <= 5
        ? 'stock-low'
        : 'stock-good'
    }`}
  >
    {Number(product.stock) <= 0
      ? 'Out of stock'
      : Number(product.stock) <= 5
      ? 'Low stock'
      : 'In stock'}
  </span>
  <div className="stock-quantity">
    {product.stock} units
  </div>
</td>

                <td>{product.is_active ? 'Active' : 'Inactive'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </section>
) : (
  
<section className="orders-panel">
  <div className="panel-heading">
    <div>
      <h2>Customer profiles</h2>
      <p>Profiles stored in your QuickCart database</p>
    </div>

    <div className="product-toolbar">
      <input
        type="text"
        placeholder="Search name, role, or ID..."
        value={customerSearch}
        onChange={(event) => setCustomerSearch(event.target.value)}
      />

      <button
        className="refresh-button"
        onClick={fetchCustomers}
      >
        ↻ Refresh customers
      </button>
    </div>
  </div>

  {filteredCustomers.length === 0 ? (
    <div className="empty-state">
      <h3>No matching profiles</h3>
      <p>
        No profiles found. Try another search or refresh the list.
      </p>
    </div>
  ) : (
    <div className="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>NAME</th>
            <th>ROLE</th>
            <th>PROFILE ID</th>
            <th>CREATED</th>
          </tr>
        </thead>

        <tbody>
          {filteredCustomers.map((customer) => (
            <tr key={customer.id}>
              <td>
                <strong>
                  {customer.full_name || 'Unnamed profile'}
                </strong>
              </td>
              <td>{customer.role || 'Not set'}</td>
              <td>
                <code>{customer.id}</code>
              </td>
              <td>
                {customer.created_at
                  ? new Date(customer.created_at).toLocaleDateString(
                      'en-IN',
                      { dateStyle: 'medium' }
                    )
                  : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )}
</section>

)}

        </section>
      </main>
    </div>
  )
}

export default App
