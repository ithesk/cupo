class POSConfig(models.Model):
    _inherit = 'pos.config'

    discount_product_id = fields.Many2one(
        'product.product',
        string='Producto Descuento Cupón',
        domain=[('type', '=', 'service')],
        help='Producto usado para aplicar descuentos de cupones'
    )

    @api.model
    def create_discount_product(self):
        """Crear producto de descuento si no existe"""
        product = self.env['product.product'].search([
            ('name', '=', 'Descuento Cupón'),
            ('type', '=', 'service')
        ], limit=1)
        
        if not product:
            product = self.env['product.product'].create({
                'name': 'Descuento Cupón',
                'type': 'service',
                'list_price': 0.0,
                'sale_ok': True,
                'purchase_ok': False,
                'available_in_pos': True,
            })
        
        return product