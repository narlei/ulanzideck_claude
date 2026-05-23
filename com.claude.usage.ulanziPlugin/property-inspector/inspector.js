$UD.connect();

$UD.onConnected(() => {
  document.querySelector('.udpi-wrapper').classList.remove('hidden');
});
