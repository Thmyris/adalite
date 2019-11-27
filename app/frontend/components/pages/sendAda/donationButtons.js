const {h, Component} = require('preact')
const connect = require('unistore/preact').connect
const actions = require('../../../actions')
const {AdaIcon} = require('../../common/svg')
const {ADALITE_FIXED_DONATION_VALUE} = require('../../../config').ADALITE_CONFIG
const {toCoins} = require('../../../helpers/adaConverters')
const tooltip = require('../../common/tooltip')

class DonationButtons extends Component {
  constructor(props) {
    super(props)
    this.getButtonClass = this.getButtonClass.bind(this)
    this.isInsufficient = this.isInsufficient.bind(this)
  }

  getButtonClass(donationAmount, type) {
    if (toCoins(donationAmount) > this.props.maxDonationAmount) {
      return 'button donate insufficient'
    }
    return this.props.checkedDonationType === type ? 'button donate active' : 'button donate'
  }

  isInsufficient(donationAmount, type) {
    if (toCoins(donationAmount) <= this.props.maxDonationAmount) {
      return false
    }
    if (this.props.checkedDonationType === type) {
      this.props.resetDonation()
    }
    return true
  }

  render({
    updateDonation,
    sendAmount,
    sendAmountValidationError,
    toggleCustomDonation,
    isSendAddressValid,
    percentageDonationValue,
    percentageDonationText,
    thresholdAmountReached,
  }) {
    const isFormValid = isSendAddressValid && sendAmount && !sendAmountValidationError
    const isFixedInsufficient = this.isInsufficient(ADALITE_FIXED_DONATION_VALUE, 'fixed')
    const isPercentageInsufficient = this.isInsufficient(percentageDonationValue, 'percentage')

    return h(
      'div',
      {
        class: 'send-donate',
      },
      h(
        'button',
        {
          'id': 'fixed',
          'class': this.getButtonClass(ADALITE_FIXED_DONATION_VALUE, 'fixed'),
          'value': ADALITE_FIXED_DONATION_VALUE,
          'onClick': updateDonation,
          'disabled': !isFormValid || isFixedInsufficient,
          'aria-label': 'Fixed amount',
          ...tooltip('Insufficient funds', isFixedInsufficient),
        },
        `${ADALITE_FIXED_DONATION_VALUE} `,
        h(AdaIcon)
      ),
      h(
        'button',
        {
          'id': 'percentage',
          'class': this.getButtonClass(percentageDonationValue, 'percentage'),
          'value': percentageDonationValue,
          'onClick': updateDonation,
          'disabled': !isFormValid || !thresholdAmountReached || isPercentageInsufficient,
          'aria-label': 'Percentage amount',
          ...tooltip('Insufficient funds', isPercentageInsufficient),
        },
        `${percentageDonationText} (`,
        `${percentageDonationValue} `,
        h(AdaIcon),
        ')'
      ),
      h(
        'button',
        {
          class: 'button donate',
          id: 'custom',
          onClick: toggleCustomDonation,
          disabled: !isFormValid,
        },
        'Custom'
      )
    )
  }
}

module.exports = connect(
  (state) => ({
    sendAmount: state.sendAmount.fieldValue,
    sendAmountValidationError: state.sendAmountValidationError,
    checkedDonationType: state.checkedDonationType,
    percentageDonationValue: state.percentageDonationValue,
    percentageDonationText: state.percentageDonationText,
    thresholdAmountReached: state.thresholdAmountReached,
    maxDonationAmount: state.maxDonationAmount,
  }),
  actions
)(DonationButtons)